import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  InventoryAdjustmentInput,
  InventoryAdjustmentHistoryPage,
  InventoryAdjustmentHistoryQuery,
  InventoryAdjustmentResult,
  InventoryListQuery,
  InventoryVariant,
  InventoryVariantPage,
} from "@aaraj/contracts";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { user } from "../auth/auth-schema.js";
import { getCurrentRequestId } from "../platform/request-context.js";
import {
  CATALOG_INVENTORY_PORT,
  type CatalogInventoryPort,
} from "../catalog/catalog-inventory.port.js";
import { InventoryPolicy } from "./inventory.policy.js";
import {
  inventoryStockBalance,
  inventoryStockMovement,
} from "./inventory-schema.js";

const MAX_STOCK_QUANTITY = 2_147_483_647;

@Injectable()
export class InventoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    @Inject(CATALOG_INVENTORY_PORT)
    private readonly catalog: CatalogInventoryPort,
  ) {}

  async listForManagement(
    actor: AccessPrincipal,
    query: InventoryListQuery,
  ): Promise<InventoryVariantPage> {
    await this.authorization.authorize(InventoryPolicy, "manage", actor);
    const catalogPage = await this.catalog.listVariants(query);
    const variantIds = catalogPage.variants.map(({ id }) => id);
    const balances = variantIds.length
      ? await this.database.db
          .select()
          .from(inventoryStockBalance)
          .where(inArray(inventoryStockBalance.variantId, variantIds))
      : [];
    const balancesByVariant = new Map(
      balances.map((balance) => [balance.variantId, balance]),
    );
    const variants: InventoryVariant[] = catalogPage.variants.map((variant) => {
      const balance = balancesByVariant.get(variant.id);
      const quantityOnHand = balance?.quantityOnHand ?? 0;
      const quantityReserved = balance?.quantityReserved ?? 0;
      return {
        ...variant,
        quantityOnHand,
        quantityReserved,
        quantityAvailable: quantityOnHand - quantityReserved,
        stockUpdatedAt: balance?.updatedAt.toISOString() ?? null,
      };
    });
    const candidateNextOffset = query.offset + variants.length;

    return {
      variants,
      limit: query.limit,
      offset: query.offset,
      hasMore: catalogPage.hasMore,
      nextOffset:
        catalogPage.hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    };
  }

  async findForManagement(
    actor: AccessPrincipal,
    variantId: string,
  ): Promise<InventoryVariant> {
    await this.authorization.authorize(InventoryPolicy, "manage", actor);
    const variant = await this.catalog.findVariant(variantId);
    if (!variant) throw new NotFoundException("Product variant not found.");

    const [balance] = await this.database.db
      .select()
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, variantId))
      .limit(1);
    const quantityOnHand = balance?.quantityOnHand ?? 0;
    const quantityReserved = balance?.quantityReserved ?? 0;
    return {
      ...variant,
      quantityOnHand,
      quantityReserved,
      quantityAvailable: quantityOnHand - quantityReserved,
      stockUpdatedAt: balance?.updatedAt.toISOString() ?? null,
    };
  }

  async listAdjustmentHistory(
    actor: AccessPrincipal,
    variantId: string,
    query: InventoryAdjustmentHistoryQuery,
  ): Promise<InventoryAdjustmentHistoryPage> {
    await this.authorization.authorize(InventoryPolicy, "manage", actor);
    const variant = await this.catalog.findVariant(variantId);
    if (!variant) throw new NotFoundException("Product variant not found.");

    const rows = await this.database.db
      .select({
        id: inventoryStockMovement.id,
        variantId: inventoryStockMovement.variantId,
        commandId: inventoryStockMovement.commandId,
        actorId: inventoryStockMovement.actorId,
        actorName: sql<string | null>`nullif(btrim(${user.name}), '')`,
        delta: inventoryStockMovement.quantityDelta,
        quantityOnHand: inventoryStockMovement.quantityAfter,
        reason: inventoryStockMovement.reason,
        createdAt: inventoryStockMovement.createdAt,
      })
      .from(inventoryStockMovement)
      .leftJoin(user, eq(user.id, inventoryStockMovement.actorId))
      .where(eq(inventoryStockMovement.variantId, variantId))
      .orderBy(
        desc(inventoryStockMovement.createdAt),
        desc(inventoryStockMovement.id),
      )
      .limit(query.limit + 1)
      .offset(query.offset);

    const movements = rows.slice(0, query.limit).map((movement) => ({
      ...movement,
      createdAt: movement.createdAt.toISOString(),
    }));
    const candidateNextOffset = query.offset + movements.length;
    const hasMore = rows.length > query.limit;
    return {
      movements,
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    };
  }

  async adjust(
    actor: AccessPrincipal,
    variantId: string,
    input: InventoryAdjustmentInput,
  ): Promise<InventoryAdjustmentResult> {
    // Authorize before checking catalog identity so a denied caller cannot use
    // this command to probe variant IDs.
    await this.authorization.authorize(InventoryPolicy, "manage", actor);

    try {
      return await this.database.db.transaction(async (transaction) => {
        await this.authorization.authorize(
          InventoryPolicy,
          "manage",
          actor,
          transaction,
        );

        // Serialize retries for this command before reading or changing stock.
        // The movement's unique key remains the durable correctness guard.
        await lockAdjustmentCommand(transaction, input.commandId);
        const [prior] = await transaction
          .select()
          .from(inventoryStockMovement)
          .where(eq(inventoryStockMovement.commandId, input.commandId))
          .limit(1);
        if (prior) {
          if (
            prior.actorId !== actor.id ||
            prior.variantId !== variantId ||
            prior.quantityDelta !== input.delta ||
            prior.reason !== input.reason
          ) {
            throw new ConflictException(
              "This command ID was already used for a different adjustment.",
            );
          }
          return toAdjustmentResult(prior);
        }

        const variant = await this.catalog.findVariantForAdjustment(
          transaction,
          variantId,
        );
        if (!variant) throw new NotFoundException("Product variant not found.");
        if (!variant.isActive && input.delta > 0) {
          throw new BadRequestException(
            "Retired variants cannot receive additional stock. Remove or reconcile the remaining stock instead.",
          );
        }

        await transaction
          .insert(inventoryStockBalance)
          .values({ variantId, quantityOnHand: 0 })
          .onConflictDoNothing({ target: inventoryStockBalance.variantId });

        const [balance] = await transaction
          .update(inventoryStockBalance)
          .set({
            quantityOnHand: sql`(${inventoryStockBalance.quantityOnHand}::bigint + ${input.delta}::bigint)::integer`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(inventoryStockBalance.variantId, variantId),
              sql`${inventoryStockBalance.quantityOnHand}::bigint + ${input.delta}::bigint BETWEEN 0 AND ${MAX_STOCK_QUANTITY}`,
              sql`${inventoryStockBalance.quantityOnHand}::bigint + ${input.delta}::bigint >= ${inventoryStockBalance.quantityReserved}`,
            ),
          )
          .returning({
            quantityOnHand: inventoryStockBalance.quantityOnHand,
            updatedAt: inventoryStockBalance.updatedAt,
          });

        if (!balance) {
          const [current] = await transaction
            .select({
              quantityOnHand: inventoryStockBalance.quantityOnHand,
              quantityReserved: inventoryStockBalance.quantityReserved,
            })
            .from(inventoryStockBalance)
            .where(eq(inventoryStockBalance.variantId, variantId))
            .limit(1);
          if (!current)
            throw new Error("Stock balance disappeared during an adjustment.");

          const nextQuantity =
            BigInt(current.quantityOnHand) + BigInt(input.delta);
          if (nextQuantity < 0n) {
            throw new ConflictException(
              "The adjustment cannot reduce stock below zero.",
            );
          }
          if (nextQuantity < BigInt(current.quantityReserved)) {
            throw new ConflictException(
              "The adjustment cannot reduce stock below actively reserved units.",
            );
          }
          throw new BadRequestException(
            "The resulting stock quantity exceeds the supported limit.",
          );
        }

        const [movement] = await transaction
          .insert(inventoryStockMovement)
          .values({
            variantId,
            quantityDelta: input.delta,
            quantityAfter: balance.quantityOnHand,
            reason: input.reason,
            actorId: actor.id,
            commandId: input.commandId,
            requestId: getCurrentRequestId(),
            createdAt: balance.updatedAt,
          })
          .returning();
        if (!movement)
          throw new Error("Stock movement insert returned no row.");

        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "inventory.stock_adjusted",
          subjectType: "inventory_variant",
          subjectId: variantId,
          reason: input.reason,
          metadata: {
            sku: variant.sku,
            movementId: movement.id,
            commandId: input.commandId,
            quantityDelta: input.delta,
            quantityOnHand: balance.quantityOnHand,
          },
        });

        return toAdjustmentResult(movement);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Defensive fallback for the database uniqueness constraint if another
        // writer did not use this service's advisory-lock protocol.
        const [prior] = await this.database.db
          .select()
          .from(inventoryStockMovement)
          .where(eq(inventoryStockMovement.commandId, input.commandId))
          .limit(1);
        if (
          prior &&
          prior.actorId === actor.id &&
          prior.variantId === variantId &&
          prior.quantityDelta === input.delta &&
          prior.reason === input.reason
        ) {
          return toAdjustmentResult(prior);
        }
        if (prior) {
          throw new ConflictException(
            "This command ID was already used for a different adjustment.",
          );
        }
      }
      throw error;
    }
  }
}

async function lockAdjustmentCommand(
  transaction: AuditTransaction,
  commandId: string,
): Promise<void> {
  const resource = JSON.stringify(["aaraj/inventory-adjustment/v1", commandId]);
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`,
  );
}

function toAdjustmentResult(
  movement: typeof inventoryStockMovement.$inferSelect,
): InventoryAdjustmentResult {
  return {
    variantId: movement.variantId,
    commandId: movement.commandId,
    delta: movement.quantityDelta,
    quantityOnHand: movement.quantityAfter,
    updatedAt: movement.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

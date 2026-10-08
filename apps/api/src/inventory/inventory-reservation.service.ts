import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CartVariantIdSchema,
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "@aaraj/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
} from "../catalog/catalog-cart.port.js";
import {
  inventoryReservationCommand,
  inventoryStockBalance,
  inventoryStockReservation,
  inventoryStockReservationLine,
} from "./inventory-schema.js";
import type {
  InventoryReservation,
  InventoryReservationOperation,
  InventoryReservationStatus,
  InventoryReserveCommand,
  InventoryReservationTransitionCommand,
  InventoryReservationPort,
  InventoryReservationLine,
} from "./inventory-reservation.port.js";

type ReservationCommandRow = typeof inventoryReservationCommand.$inferSelect;

@Injectable()
export class InventoryReservationService implements InventoryReservationPort {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CATALOG_CART_PORT) private readonly catalog: CatalogCartPort,
  ) {}

  async reserve(
    command: InventoryReserveCommand,
  ): Promise<InventoryReservation> {
    const lines = aggregateLines(command.lines);
    const purchasable = await this.catalog.findPurchasableVariants(
      lines.map(({ variantId }) => variantId),
    );
    const purchasableIds = new Set(
      purchasable.map(({ variantId }) => variantId),
    );
    return this.database.db.transaction((transaction) =>
      this.reserveInTransaction(transaction, command, lines, purchasableIds),
    );
  }

  async reserveWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReserveCommand,
  ): Promise<InventoryReservation> {
    const lines = aggregateLines(command.lines);
    return this.reserveInTransaction(transaction, command, lines);
  }

  private async reserveInTransaction(
    transaction: AuditTransaction,
    command: InventoryReserveCommand,
    lines: readonly InventoryReservationLine[],
    purchasableIds?: ReadonlySet<string>,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const fingerprint = fingerprintRequest("reserve", lines);

    await lockReservationCommand(transaction, commandId);
    const existing = await findCommand(transaction, commandId);
    if (existing) {
      return this.replayInTransaction(
        transaction,
        existing,
        "reserve",
        fingerprint,
      );
    }
    if (
      purchasableIds &&
      lines.some(({ variantId }) => !purchasableIds.has(variantId))
    ) {
      throw new ConflictException(
        "One or more variants are no longer purchasable.",
      );
    }

    const [reservation] = await transaction
      .insert(inventoryStockReservation)
      .values({ status: "held" })
      .returning();
    if (!reservation) throw new Error("Reservation insert returned no row.");

    await transaction.insert(inventoryStockReservationLine).values(
      lines.map((line) => ({
        reservationId: reservation.id,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    );

    for (const line of lines) {
      await transaction
        .insert(inventoryStockBalance)
        .values({ variantId: line.variantId, quantityOnHand: 0 })
        .onConflictDoNothing({ target: inventoryStockBalance.variantId });

      const [balance] = await transaction
        .update(inventoryStockBalance)
        .set({
          quantityReserved: sql`${inventoryStockBalance.quantityReserved} + ${line.quantity}`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(inventoryStockBalance.variantId, line.variantId),
            sql`${inventoryStockBalance.quantityOnHand}::bigint - ${inventoryStockBalance.quantityReserved}::bigint >= ${line.quantity}`,
          ),
        )
        .returning({ variantId: inventoryStockBalance.variantId });

      if (!balance) {
        throw new ConflictException(
          "One or more variants do not have enough available stock.",
        );
      }
    }

    await transaction.insert(inventoryReservationCommand).values({
      commandId,
      reservationId: reservation.id,
      operation: "reserve",
      requestFingerprint: fingerprint,
    });
    await this.appendTransitionAudit(transaction, {
      operation: "reserve",
      commandId,
      reservationId: reservation.id,
      lines,
    });

    const result = await loadReservation(transaction, reservation.id);
    if (!result) throw new Error("Created reservation could not be read.");
    return result;
  }

  release(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    return this.transition("release", command);
  }

  releaseWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    return this.transitionWithinTransaction(transaction, "release", command);
  }

  consume(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    return this.transition("consume", command);
  }

  async getReservation(
    reservationId: string,
  ): Promise<InventoryReservation | null> {
    const id = requireUuid(reservationId, "reservationId");
    return this.database.db.transaction((transaction) =>
      loadReservation(transaction, id),
    );
  }

  private async transition(
    operation: "release" | "consume",
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const reservationId = requireUuid(command.reservationId, "reservationId");
    const fingerprint = fingerprintRequest(operation, { reservationId });

    const prior = await this.findCommand(commandId);
    if (prior) return this.replay(prior, operation, fingerprint);

    return this.database.db.transaction((transaction) =>
      this.transitionWithinTransaction(transaction, operation, {
        commandId,
        reservationId,
      }),
    );
  }

  private async transitionWithinTransaction(
    transaction: AuditTransaction,
    operation: "release" | "consume",
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const reservationId = requireUuid(command.reservationId, "reservationId");
    const fingerprint = fingerprintRequest(operation, { reservationId });
    await lockReservationCommand(transaction, commandId);
    const existing = await findCommand(transaction, commandId);
    if (existing) {
      return this.replayInTransaction(
        transaction,
        existing,
        operation,
        fingerprint,
      );
    }

    const [reservation] = await transaction
      .select()
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, reservationId))
      .for("update")
      .limit(1);
    if (!reservation) throw new NotFoundException("Reservation not found.");

    const requestedStatus: InventoryReservationStatus =
      operation === "release" ? "released" : "consumed";
    if (
      reservation.status !== "held" &&
      reservation.status !== requestedStatus
    ) {
      throw new ConflictException(
        `A ${reservation.status} reservation cannot be ${operation}d.`,
      );
    }

    const lines = await transaction
      .select({
        variantId: inventoryStockReservationLine.variantId,
        quantity: inventoryStockReservationLine.quantity,
      })
      .from(inventoryStockReservationLine)
      .where(eq(inventoryStockReservationLine.reservationId, reservationId))
      .orderBy(asc(inventoryStockReservationLine.variantId));

    const changed = reservation.status === "held";
    if (changed) {
      for (const line of lines) {
        const [balance] = await transaction
          .update(inventoryStockBalance)
          .set(
            operation === "release"
              ? {
                  quantityReserved: sql`${inventoryStockBalance.quantityReserved} - ${line.quantity}`,
                  updatedAt: sql`clock_timestamp()`,
                }
              : {
                  quantityOnHand: sql`${inventoryStockBalance.quantityOnHand} - ${line.quantity}`,
                  quantityReserved: sql`${inventoryStockBalance.quantityReserved} - ${line.quantity}`,
                  updatedAt: sql`clock_timestamp()`,
                },
          )
          .where(
            and(
              eq(inventoryStockBalance.variantId, line.variantId),
              sql`${inventoryStockBalance.quantityReserved} >= ${line.quantity}`,
              operation === "consume"
                ? sql`${inventoryStockBalance.quantityOnHand} >= ${line.quantity}`
                : undefined,
            ),
          )
          .returning({ variantId: inventoryStockBalance.variantId });

        if (!balance) {
          throw new Error(
            "Reservation stock balance is missing or violates its quantity invariant.",
          );
        }
      }

      const [updated] = await transaction
        .update(inventoryStockReservation)
        .set({ status: requestedStatus, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(inventoryStockReservation.id, reservationId),
            eq(inventoryStockReservation.status, "held"),
          ),
        )
        .returning({ id: inventoryStockReservation.id });
      if (!updated) throw new Error("Held reservation changed while locked.");

      await this.appendTransitionAudit(transaction, {
        operation,
        commandId,
        reservationId,
        lines,
      });
    }

    await transaction.insert(inventoryReservationCommand).values({
      commandId,
      reservationId,
      operation,
      requestFingerprint: fingerprint,
    });

    const result = await loadReservation(transaction, reservationId);
    if (!result) throw new Error("Reservation disappeared during transition.");
    return result;
  }

  private async findCommand(
    commandId: string,
  ): Promise<ReservationCommandRow | undefined> {
    const [command] = await this.database.db
      .select()
      .from(inventoryReservationCommand)
      .where(eq(inventoryReservationCommand.commandId, commandId))
      .limit(1);
    return command;
  }

  private async replay(
    command: ReservationCommandRow,
    operation: InventoryReservationOperation,
    fingerprint: string,
  ): Promise<InventoryReservation> {
    assertSameCommand(command, operation, fingerprint);
    const reservation = await this.getReservation(command.reservationId);
    if (!reservation)
      throw new Error("Reservation command refers to a missing reservation.");
    return reservation;
  }

  private async replayInTransaction(
    transaction: AuditTransaction,
    command: ReservationCommandRow,
    operation: InventoryReservationOperation,
    fingerprint: string,
  ): Promise<InventoryReservation> {
    assertSameCommand(command, operation, fingerprint);
    const reservation = await loadReservation(
      transaction,
      command.reservationId,
    );
    if (!reservation)
      throw new Error("Reservation command refers to a missing reservation.");
    return reservation;
  }

  private appendTransitionAudit(
    transaction: AuditTransaction,
    input: {
      operation: InventoryReservationOperation;
      commandId: string;
      reservationId: string;
      lines: readonly InventoryReservationLine[];
    },
  ): Promise<string> {
    return this.audit.append(transaction, {
      actorType: "service",
      actorId: "inventory",
      eventType: `inventory.stock_${input.operation === "reserve" ? "reserved" : input.operation === "release" ? "released" : "consumed"}`,
      subjectType: "inventory_reservation",
      subjectId: input.reservationId,
      metadata: {
        commandId: input.commandId,
        lineCount: input.lines.length,
        totalQuantity: input.lines.reduce(
          (total, line) => total + line.quantity,
          0,
        ),
      },
    });
  }
}

function requireUuid(value: string, field: string): string {
  const parsed = CartVariantIdSchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(`${field} must be a UUID.`);
  return parsed.data.toLowerCase();
}

function aggregateLines(
  input: readonly InventoryReservationLine[],
): InventoryReservationLine[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAX_CART_LINES
  ) {
    throw new BadRequestException(
      `A reservation must contain between 1 and ${MAX_CART_LINES} lines.`,
    );
  }

  const quantities = new Map<string, number>();
  for (const line of input) {
    const variantId = requireUuid(line.variantId, "variantId");
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_CART_QUANTITY_PER_VARIANT
    ) {
      throw new BadRequestException(
        `Each variant quantity must be between 1 and ${MAX_CART_QUANTITY_PER_VARIANT}.`,
      );
    }
    const quantity = (quantities.get(variantId) ?? 0) + line.quantity;
    if (quantity > MAX_CART_QUANTITY_PER_VARIANT) {
      throw new BadRequestException(
        `The aggregated quantity for a variant cannot exceed ${MAX_CART_QUANTITY_PER_VARIANT}.`,
      );
    }
    quantities.set(variantId, quantity);
  }

  return [...quantities]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

function fingerprintRequest(
  operation: InventoryReservationOperation,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, operation, payload }))
    .digest("hex");
}

function assertSameCommand(
  existing: ReservationCommandRow,
  operation: InventoryReservationOperation,
  fingerprint: string,
): void {
  if (
    existing.operation !== operation ||
    existing.requestFingerprint !== fingerprint
  ) {
    throw new ConflictException(
      "This command ID was already used for a different reservation operation.",
    );
  }
}

async function lockReservationCommand(
  transaction: AuditTransaction,
  commandId: string,
): Promise<void> {
  const resource = JSON.stringify([
    "aaraj/inventory-reservation/v1",
    commandId,
  ]);
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`,
  );
}

async function findCommand(
  transaction: AuditTransaction,
  commandId: string,
): Promise<ReservationCommandRow | undefined> {
  const [command] = await transaction
    .select()
    .from(inventoryReservationCommand)
    .where(eq(inventoryReservationCommand.commandId, commandId))
    .limit(1);
  return command;
}

async function loadReservation(
  transaction: AuditTransaction,
  reservationId: string,
): Promise<InventoryReservation | null> {
  const [reservation] = await transaction
    .select()
    .from(inventoryStockReservation)
    .where(eq(inventoryStockReservation.id, reservationId))
    .limit(1);
  if (!reservation) return null;

  const lines = await transaction
    .select({
      variantId: inventoryStockReservationLine.variantId,
      quantity: inventoryStockReservationLine.quantity,
    })
    .from(inventoryStockReservationLine)
    .where(eq(inventoryStockReservationLine.reservationId, reservationId))
    .orderBy(asc(inventoryStockReservationLine.variantId));

  return {
    id: reservation.id,
    status: reservation.status,
    lines,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

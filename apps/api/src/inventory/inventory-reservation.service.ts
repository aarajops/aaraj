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
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
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
  InventoryReservationExtendCommand,
  InventoryReservationReleaseLinesCommand,
  InventoryReservationTransitionCommand,
  InventoryReservationPort,
  InventoryReservationLine,
} from "./inventory-reservation.port.js";

type ReservationCommandRow = Pick<
  typeof inventoryReservationCommand.$inferSelect,
  "reservationId" | "operation" | "requestFingerprint"
>;

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
    return this.database.db.transaction(async (transaction) => {
      const purchasable =
        await this.catalog.findPurchasableVariantsWithinTransaction(
          transaction,
          lines.map(({ variantId }) => variantId),
        );
      const purchasableIds = new Set(
        purchasable.map(({ variantId }) => variantId),
      );
      return this.reserveInTransaction(
        transaction,
        command,
        lines,
        purchasableIds,
      );
    });
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

    await ensureStockBalances(transaction, lines);
    await applyStockBalanceDeltas(transaction, lines, "reserve");

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

    return {
      id: reservation.id,
      status: "held",
      lines: [...lines],
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
    };
  }

  async extendWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationExtendCommand,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const reservationId = requireUuid(command.reservationId, "reservationId");
    const lines = aggregateLines(command.lines);
    const fingerprint = fingerprintRequest("extend", { reservationId, lines });

    await lockReservationCommand(transaction, commandId);
    const existing = await findCommand(transaction, commandId);
    if (existing) {
      return this.replayInTransaction(
        transaction,
        existing,
        "extend",
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
    if (reservation.status !== "held") {
      throw new ConflictException(
        "Items can only be added while the Order stock reservation is held.",
        { errorCode: "ORDER_RESERVATION_NOT_HELD" },
      );
    }

    const existingLines = await transaction
      .select({
        variantId: inventoryStockReservationLine.variantId,
        quantity: inventoryStockReservationLine.quantity,
      })
      .from(inventoryStockReservationLine)
      .where(eq(inventoryStockReservationLine.reservationId, reservationId));
    const existingQuantities = new Map(
      existingLines.map(({ variantId, quantity }) => [variantId, quantity]),
    );
    if (
      lines.some(
        ({ variantId, quantity }) =>
          (existingQuantities.get(variantId) ?? 0) + quantity >
          MAX_CART_QUANTITY_PER_VARIANT,
      )
    ) {
      throw new ConflictException(
        `A reserved variant cannot exceed ${MAX_CART_QUANTITY_PER_VARIANT} units.`,
        { errorCode: "ORDER_ITEM_QUANTITY_LIMIT_REACHED" },
      );
    }

    await ensureStockBalances(transaction, lines);
    await applyStockBalanceDeltas(transaction, lines, "reserve");

    const newLines = lines.filter(
      ({ variantId }) => !existingQuantities.has(variantId),
    );
    if (newLines.length > 0) {
      await transaction
        .insert(inventoryStockReservationLine)
        .values(newLines.map((line) => ({ reservationId, ...line })));
    }

    const existingUpdates = lines.flatMap((line) => {
      const currentQuantity = existingQuantities.get(line.variantId);
      return currentQuantity === undefined
        ? []
        : [{ ...line, currentQuantity }];
    });
    if (existingUpdates.length > 0) {
      const additionalQuantityCase = sql`CASE ${inventoryStockReservationLine.variantId} ${sql.join(
        existingUpdates.map(
          (line) =>
            sql`WHEN ${line.variantId}::uuid THEN ${line.quantity}::integer`,
        ),
        sql` `,
      )} ELSE 0 END`;
      const expectedQuantityCase = sql`CASE ${inventoryStockReservationLine.variantId} ${sql.join(
        existingUpdates.map(
          (line) =>
            sql`WHEN ${line.variantId}::uuid THEN ${line.currentQuantity}::integer`,
        ),
        sql` `,
      )} ELSE 0 END`;
      const updatedLines = await transaction
        .update(inventoryStockReservationLine)
        .set({
          quantity: sql`${expectedQuantityCase} + ${additionalQuantityCase}`,
        })
        .where(
          and(
            eq(inventoryStockReservationLine.reservationId, reservationId),
            inArray(
              inventoryStockReservationLine.variantId,
              existingUpdates.map(({ variantId }) => variantId),
            ),
            sql`${inventoryStockReservationLine.quantity} = ${expectedQuantityCase}`,
          ),
        )
        .returning({ variantId: inventoryStockReservationLine.variantId });
      if (updatedLines.length !== existingUpdates.length) {
        throw new ConflictException(
          "The Order stock reservation changed before it could be extended.",
          { errorCode: "ORDER_RESERVATION_UPDATE_CONFLICT" },
        );
      }
    }
    await transaction.insert(inventoryReservationCommand).values({
      commandId,
      reservationId,
      operation: "extend",
      requestFingerprint: fingerprint,
    });
    await this.appendTransitionAudit(transaction, {
      operation: "extend",
      commandId,
      reservationId,
      lines,
    });

    const addedQuantities = new Map(
      lines.map(({ variantId, quantity }) => [variantId, quantity]),
    );
    const resultingLines = existingLines.map(({ variantId, quantity }) => ({
      variantId,
      quantity: quantity + (addedQuantities.get(variantId) ?? 0),
    }));
    for (const line of lines) {
      if (!existingQuantities.has(line.variantId)) resultingLines.push(line);
    }
    return toInventoryReservation(reservation, resultingLines);
  }

  async releaseLinesWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationReleaseLinesCommand,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const reservationId = requireUuid(command.reservationId, "reservationId");
    const lines = aggregateLines(command.lines);
    const fingerprint = fingerprintRequest("release", {
      reservationId,
      lines,
    });

    await lockReservationCommand(transaction, commandId);
    const existingCommand = await findCommand(transaction, commandId);
    if (existingCommand) {
      return this.replayInTransaction(
        transaction,
        existingCommand,
        "release",
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
    if (reservation.status !== "held") {
      throw new ConflictException(
        "Items can only be removed while the Order stock reservation is held.",
        { errorCode: "ORDER_RESERVATION_NOT_HELD" },
      );
    }

    const existingLines = await transaction
      .select({
        variantId: inventoryStockReservationLine.variantId,
        quantity: inventoryStockReservationLine.quantity,
      })
      .from(inventoryStockReservationLine)
      .where(eq(inventoryStockReservationLine.reservationId, reservationId));
    const existingQuantities = new Map(
      existingLines.map(({ variantId, quantity }) => [variantId, quantity]),
    );
    for (const line of lines) {
      const currentQuantity = existingQuantities.get(line.variantId);
      if (currentQuantity === undefined || currentQuantity !== line.quantity) {
        throw new ConflictException(
          "The Order stock reservation changed before the item could be removed.",
          { errorCode: "ORDER_RESERVATION_UPDATE_CONFLICT" },
        );
      }
    }

    await applyStockBalanceDeltas(transaction, lines, "release");

    const expectedQuantityCase = caseForLines(
      lines,
      inventoryStockReservationLine.variantId,
      (line) => sql`${line.quantity}::integer`,
    );
    const deletedLines = await transaction
      .delete(inventoryStockReservationLine)
      .where(
        and(
          eq(inventoryStockReservationLine.reservationId, reservationId),
          inArray(
            inventoryStockReservationLine.variantId,
            lines.map(({ variantId }) => variantId),
          ),
          sql`${inventoryStockReservationLine.quantity} = ${expectedQuantityCase}`,
        ),
      )
      .returning({ variantId: inventoryStockReservationLine.variantId });
    if (deletedLines.length !== lines.length) {
      throw new ConflictException(
        "The Order stock reservation changed before the item could be removed.",
        { errorCode: "ORDER_RESERVATION_UPDATE_CONFLICT" },
      );
    }

    await transaction.insert(inventoryReservationCommand).values({
      commandId,
      reservationId,
      operation: "release",
      requestFingerprint: fingerprint,
    });
    await this.appendTransitionAudit(transaction, {
      operation: "release",
      commandId,
      reservationId,
      lines,
    });

    const releasedVariantIds = new Set(lines.map(({ variantId }) => variantId));
    return toInventoryReservation(
      reservation,
      existingLines.filter(
        ({ variantId }) => !releasedVariantIds.has(variantId),
      ),
    );
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

  consumeWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation> {
    return this.transitionWithinTransaction(
      transaction,
      "consume",
      command,
      true,
    );
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
    requireHeld = false,
  ): Promise<InventoryReservation> {
    const commandId = requireUuid(command.commandId, "commandId");
    const reservationId = requireUuid(command.reservationId, "reservationId");
    const fingerprint = fingerprintRequest(operation, { reservationId });
    await lockReservationCommand(transaction, commandId);
    const existing = await findCommand(transaction, commandId);
    if (existing) {
      if (requireHeld) {
        throw new ConflictException(
          "A new courier handoff requires a held reservation and a new consume command.",
          { errorCode: "ORDER_RESERVATION_NOT_HELD" },
        );
      }
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

    if (requireHeld && reservation.status !== "held") {
      throw new ConflictException(
        "The Order reservation must still be held before courier pickup.",
        { errorCode: "ORDER_RESERVATION_NOT_HELD" },
      );
    }

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
    let updatedReservation = reservation;
    if (changed) {
      await applyStockBalanceDeltas(transaction, lines, operation);

      const [updated] = await transaction
        .update(inventoryStockReservation)
        .set({ status: requestedStatus, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(inventoryStockReservation.id, reservationId),
            eq(inventoryStockReservation.status, "held"),
          ),
        )
        .returning({ updatedAt: inventoryStockReservation.updatedAt });
      if (!updated?.updatedAt)
        throw new Error("Held reservation changed while locked.");
      updatedReservation = {
        ...reservation,
        status: requestedStatus,
        updatedAt: updated.updatedAt,
      };

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

    return toInventoryReservation(updatedReservation, lines);
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
      eventType: `inventory.stock_${input.operation === "reserve" ? "reserved" : input.operation === "extend" ? "extended" : input.operation === "release" ? "released" : "consumed"}`,
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
    .select({
      reservationId: inventoryReservationCommand.reservationId,
      operation: inventoryReservationCommand.operation,
      requestFingerprint: inventoryReservationCommand.requestFingerprint,
    })
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

  return toInventoryReservation(reservation, lines);
}

function toInventoryReservation(
  reservation: typeof inventoryStockReservation.$inferSelect,
  lines: readonly InventoryReservationLine[],
): InventoryReservation {
  return {
    id: reservation.id,
    status: reservation.status,
    lines: [...lines].sort((left, right) =>
      left.variantId < right.variantId
        ? -1
        : left.variantId > right.variantId
          ? 1
          : 0,
    ),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

type StockBalanceOperation = "reserve" | "release" | "consume";

async function ensureStockBalances(
  transaction: AuditTransaction,
  lines: readonly InventoryReservationLine[],
): Promise<void> {
  if (lines.length === 0) return;
  await transaction
    .insert(inventoryStockBalance)
    .values(lines.map(({ variantId }) => ({ variantId, quantityOnHand: 0 })))
    .onConflictDoNothing({ target: inventoryStockBalance.variantId });
}

async function lockStockBalances(
  transaction: AuditTransaction,
  lines: readonly InventoryReservationLine[],
): Promise<void> {
  if (lines.length === 0) return;
  const balances = await transaction
    .select({ variantId: inventoryStockBalance.variantId })
    .from(inventoryStockBalance)
    .where(
      inArray(
        inventoryStockBalance.variantId,
        lines.map(({ variantId }) => variantId),
      ),
    )
    .orderBy(asc(inventoryStockBalance.variantId))
    .for("update");
  if (balances.length !== lines.length) {
    throw new Error(
      "Reservation stock balance is missing or violates its quantity invariant.",
    );
  }
}

async function applyStockBalanceDeltas(
  transaction: AuditTransaction,
  lines: readonly InventoryReservationLine[],
  operation: StockBalanceOperation,
): Promise<void> {
  if (lines.length === 0) return;
  await lockStockBalances(transaction, lines);

  const quantityDelta = caseForLines(
    lines,
    inventoryStockBalance.variantId,
    (line) => sql`${line.quantity}::integer`,
  );
  const validBalance = caseForLines(
    lines,
    inventoryStockBalance.variantId,
    (line) => {
      if (operation === "reserve") {
        return sql`${inventoryStockBalance.quantityOnHand}::bigint - ${inventoryStockBalance.quantityReserved}::bigint >= ${line.quantity}`;
      }
      if (operation === "release") {
        return sql`${inventoryStockBalance.quantityReserved} >= ${line.quantity}`;
      }
      return sql`${inventoryStockBalance.quantityReserved} >= ${line.quantity} AND ${inventoryStockBalance.quantityOnHand} >= ${line.quantity}`;
    },
    sql`FALSE`,
  );

  const changed = await transaction
    .update(inventoryStockBalance)
    .set({
      ...(operation === "consume"
        ? {
            quantityOnHand: sql`${inventoryStockBalance.quantityOnHand} - ${quantityDelta}`,
          }
        : {}),
      quantityReserved:
        operation === "reserve"
          ? sql`${inventoryStockBalance.quantityReserved} + ${quantityDelta}`
          : sql`${inventoryStockBalance.quantityReserved} - ${quantityDelta}`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        inArray(
          inventoryStockBalance.variantId,
          lines.map(({ variantId }) => variantId),
        ),
        validBalance,
      ),
    )
    .returning({ variantId: inventoryStockBalance.variantId });

  if (changed.length !== lines.length) {
    if (operation === "reserve") {
      throw new ConflictException(
        "One or more variants do not have enough available stock.",
        { errorCode: "ORDER_ITEM_STOCK_UNAVAILABLE" },
      );
    }
    throw new Error(
      "Reservation stock balance is missing or violates its quantity invariant.",
    );
  }
}

function caseForLines(
  lines: readonly InventoryReservationLine[],
  variantIdColumn:
    | typeof inventoryStockBalance.variantId
    | typeof inventoryStockReservationLine.variantId,
  valueForLine: (line: InventoryReservationLine) => SQL,
  fallback: SQL = sql`0`,
): SQL {
  return sql`CASE ${variantIdColumn} ${sql.join(
    lines.map(
      (line) => sql`WHEN ${line.variantId}::uuid THEN ${valueForLine(line)}`,
    ),
    sql` `,
  )} ELSE ${fallback} END`;
}

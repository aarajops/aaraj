import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const inventorySchema = pgSchema("inventory");

export const inventoryStockBalance = inventorySchema.table(
  "stock_balance",
  {
    variantId: uuid("variant_id").primaryKey(),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "stock_balance_quantity_nonnegative_check",
      sql`${table.quantityOnHand} >= 0`,
    ),
  ],
);

export const inventoryStockMovement = inventorySchema.table(
  "stock_movement",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id").notNull(),
    commandId: uuid("command_id").notNull(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_movement_command_uidx").on(table.commandId),
    index("stock_movement_variant_created_idx").on(
      table.variantId,
      table.createdAt,
      table.id,
    ),
    check(
      "stock_movement_delta_nonzero_check",
      sql`${table.quantityDelta} <> 0`,
    ),
    check(
      "stock_movement_result_nonnegative_check",
      sql`${table.quantityAfter} >= 0 AND ${table.quantityAfter}::bigint - ${table.quantityDelta}::bigint BETWEEN 0 AND 2147483647`,
    ),
    check(
      "stock_movement_reason_nonempty_check",
      sql`${table.reason} = btrim(${table.reason}) AND length(${table.reason}) BETWEEN 3 AND 500`,
    ),
    check(
      "stock_movement_actor_nonempty_check",
      sql`${table.actorId} = btrim(${table.actorId}) AND length(${table.actorId}) > 0`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const catalogSchema = pgSchema("catalog");

export const catalogProduct = catalogSchema.table(
  "product",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_slug_uidx").on(table.slug),
    index("product_published_updated_idx").on(
      table.isPublished,
      table.updatedAt,
    ),
    check(
      "product_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "product_name_nonempty_check",
      sql`${table.name} = btrim(${table.name}) AND length(${table.name}) > 0`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  AnyPgColumn,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CatalogMeasurementKey } from "@aaraj/contracts";

export const catalogSchema = pgSchema("catalog");

export const catalogCategory = catalogSchema.table(
  "category",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => catalogCategory.id,
      { onDelete: "restrict" },
    ),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("category_slug_uidx").on(table.slug),
    index("category_parent_order_idx").on(table.parentId, table.sortOrder),
    check(
      "category_name_nonempty_check",
      sql`${table.name} = btrim(${table.name}) AND length(${table.name}) > 0`,
    ),
    check(
      "category_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("category_sort_order_check", sql`${table.sortOrder} >= 0`),
    check(
      "category_parent_not_self_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  ],
);

export const catalogSizeGuide = catalogSchema.table(
  "size_guide",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => catalogCategory.id, { onDelete: "restrict" }),
    fit: text("fit"),
    measurementBasis: text("measurement_basis")
      .$type<"garment" | "body">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("size_guide_category_id_idx").on(table.categoryId),
    check(
      "size_guide_name_nonempty_check",
      sql`${table.name} = btrim(${table.name}) AND length(${table.name}) > 0`,
    ),
    check(
      "size_guide_measurement_basis_check",
      sql`${table.measurementBasis} in ('garment', 'body')`,
    ),
  ],
);

export const catalogSizeGuideRow = catalogSchema.table(
  "size_guide_row",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => catalogSizeGuide.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("size_guide_row_label_uidx").on(
      table.guideId,
      sql`lower(btrim(${table.sizeLabel}))`,
    ),
    uniqueIndex("size_guide_row_order_uidx").on(table.guideId, table.sortOrder),
    check(
      "size_guide_row_label_nonempty_check",
      sql`${table.sizeLabel} = btrim(${table.sizeLabel}) AND length(${table.sizeLabel}) > 0`,
    ),
    check("size_guide_row_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const catalogSizeGuideMeasurement = catalogSchema.table(
  "size_guide_measurement",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rowId: uuid("row_id")
      .notNull()
      .references(() => catalogSizeGuideRow.id, { onDelete: "cascade" }),
    key: text("key").$type<CatalogMeasurementKey>().notNull(),
    valueMm: numeric("value_mm", { precision: 8, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex("size_guide_measurement_key_uidx").on(table.rowId, table.key),
    check(
      "size_guide_measurement_key_check",
      sql`${table.key} in ('chest_width', 'body_length', 'shoulder_width', 'sleeve_length', 'waist', 'hip', 'inseam', 'outseam', 'rise', 'thigh', 'hem')`,
    ),
    check("size_guide_measurement_value_check", sql`${table.valueMm} > 0`),
  ],
);

export const catalogProduct = catalogSchema.table(
  "product",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    audience: text("audience").$type<"men" | "women" | "unisex">(),
    categoryId: uuid("category_id").references(() => catalogCategory.id, {
      onDelete: "restrict",
    }),
    fit: text("fit"),
    fabricComposition: text("fabric_composition"),
    careInstructions: text("care_instructions"),
    sizeGuideId: uuid("size_guide_id").references(() => catalogSizeGuide.id, {
      onDelete: "restrict",
    }),
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
    index("product_category_id_idx").on(table.categoryId),
    index("product_published_updated_idx").on(
      table.isPublished,
      table.updatedAt,
      table.id,
    ),
    index("product_size_guide_published_idx").on(
      table.sizeGuideId,
      table.isPublished,
    ),
    check(
      "product_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "product_name_nonempty_check",
      sql`${table.name} = btrim(${table.name}) AND length(${table.name}) > 0`,
    ),
    check(
      "product_audience_check",
      sql`${table.audience} is null or ${table.audience} in ('men', 'women', 'unisex')`,
    ),
  ],
);

export const catalogProductVariant = catalogSchema.table(
  "product_variant",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => catalogProduct.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    color: text("color").notNull(),
    sizeLabel: text("size_label").notNull(),
    priceBdt: integer("price_bdt"),
    gtin: text("gtin"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_variant_sku_uidx").on(sql`lower(btrim(${table.sku}))`),
    uniqueIndex("product_variant_product_color_size_uidx").on(
      table.productId,
      sql`lower(btrim(${table.color}))`,
      sql`lower(btrim(${table.sizeLabel}))`,
    ),
    index("product_variant_product_active_idx").on(
      table.productId,
      table.isActive,
    ),
    check(
      "product_variant_fields_nonempty_check",
      sql`${table.sku} = btrim(${table.sku}) AND length(${table.sku}) > 0 AND ${table.color} = btrim(${table.color}) AND length(${table.color}) > 0 AND ${table.sizeLabel} = btrim(${table.sizeLabel}) AND length(${table.sizeLabel}) > 0`,
    ),
    check(
      "product_variant_gtin_check",
      sql`${table.gtin} is null OR ${table.gtin} ~ '^([0-9]{8}|[0-9]{12,14})$'`,
    ),
    check(
      "product_variant_price_bdt_check",
      sql`${table.priceBdt} is null OR ${table.priceBdt} >= 0`,
    ),
  ],
);

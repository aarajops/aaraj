CREATE TABLE "catalog"."product_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"color" text NOT NULL,
	"size_label" text NOT NULL,
	"gtin" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_fields_nonempty_check" CHECK ("catalog"."product_variant"."sku" = btrim("catalog"."product_variant"."sku") AND length("catalog"."product_variant"."sku") > 0 AND "catalog"."product_variant"."color" = btrim("catalog"."product_variant"."color") AND length("catalog"."product_variant"."color") > 0 AND "catalog"."product_variant"."size_label" = btrim("catalog"."product_variant"."size_label") AND length("catalog"."product_variant"."size_label") > 0),
	CONSTRAINT "product_variant_gtin_check" CHECK ("catalog"."product_variant"."gtin" is null OR "catalog"."product_variant"."gtin" ~ '^([0-9]{8}|[0-9]{12,14})$')
);
--> statement-breakpoint
CREATE TABLE "catalog"."size_guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"fit" text,
	"measurement_basis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "size_guide_name_nonempty_check" CHECK ("catalog"."size_guide"."name" = btrim("catalog"."size_guide"."name") AND length("catalog"."size_guide"."name") > 0),
	CONSTRAINT "size_guide_category_nonempty_check" CHECK ("catalog"."size_guide"."category" = btrim("catalog"."size_guide"."category") AND length("catalog"."size_guide"."category") > 0),
	CONSTRAINT "size_guide_measurement_basis_check" CHECK ("catalog"."size_guide"."measurement_basis" in ('garment', 'body'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."size_guide_measurement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"row_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_mm" numeric(8, 2) NOT NULL,
	CONSTRAINT "size_guide_measurement_key_check" CHECK ("catalog"."size_guide_measurement"."key" in ('chest_width', 'body_length', 'shoulder_width', 'sleeve_length', 'waist', 'hip', 'inseam', 'outseam', 'rise', 'thigh', 'hem')),
	CONSTRAINT "size_guide_measurement_value_check" CHECK ("catalog"."size_guide_measurement"."value_mm" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog"."size_guide_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guide_id" uuid NOT NULL,
	"size_label" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "size_guide_row_label_nonempty_check" CHECK ("catalog"."size_guide_row"."size_label" = btrim("catalog"."size_guide_row"."size_label") AND length("catalog"."size_guide_row"."size_label") > 0),
	CONSTRAINT "size_guide_row_order_check" CHECK ("catalog"."size_guide_row"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "fit" text;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "fabric_composition" text;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "care_instructions" text;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "size_guide_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog"."product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" ADD CONSTRAINT "size_guide_measurement_row_id_size_guide_row_id_fk" FOREIGN KEY ("row_id") REFERENCES "catalog"."size_guide_row"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_row" ADD CONSTRAINT "size_guide_row_guide_id_size_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "catalog"."size_guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_sku_uidx" ON "catalog"."product_variant" USING btree (lower(btrim("sku")));--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_product_color_size_uidx" ON "catalog"."product_variant" USING btree ("product_id",lower(btrim("color")),lower(btrim("size_label")));--> statement-breakpoint
CREATE INDEX "product_variant_product_active_idx" ON "catalog"."product_variant" USING btree ("product_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "size_guide_measurement_key_uidx" ON "catalog"."size_guide_measurement" USING btree ("row_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "size_guide_row_label_uidx" ON "catalog"."size_guide_row" USING btree ("guide_id",lower(btrim("size_label")));--> statement-breakpoint
CREATE UNIQUE INDEX "size_guide_row_order_uidx" ON "catalog"."size_guide_row" USING btree ("guide_id","sort_order");--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD CONSTRAINT "product_size_guide_id_size_guide_id_fk" FOREIGN KEY ("size_guide_id") REFERENCES "catalog"."size_guide"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD CONSTRAINT "product_audience_check" CHECK ("catalog"."product"."audience" is null or "catalog"."product"."audience" in ('men', 'women', 'unisex'));--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD CONSTRAINT "product_category_nonempty_check" CHECK ("catalog"."product"."category" is null or ("catalog"."product"."category" = btrim("catalog"."product"."category") AND length("catalog"."product"."category") > 0));
CREATE TABLE "catalog"."category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_name_nonempty_check" CHECK ("catalog"."category"."name" = btrim("catalog"."category"."name") AND length("catalog"."category"."name") > 0),
	CONSTRAINT "category_slug_format_check" CHECK ("catalog"."category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "category_sort_order_check" CHECK ("catalog"."category"."sort_order" >= 0),
	CONSTRAINT "category_parent_not_self_check" CHECK ("catalog"."category"."parent_id" is null or "catalog"."category"."parent_id" <> "catalog"."category"."id")
);
--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
WITH source_names AS (
	SELECT btrim("category") AS display_name, lower(btrim("category")) AS normalized_name
	FROM "catalog"."product"
	WHERE "category" IS NOT NULL AND length(btrim("category")) > 0
	UNION ALL
	SELECT btrim("category") AS display_name, lower(btrim("category")) AS normalized_name
	FROM "catalog"."size_guide"
	WHERE length(btrim("category")) > 0
), grouped_names AS (
	SELECT normalized_name, min(display_name) AS display_name
	FROM source_names
	GROUP BY normalized_name
), base_slugs AS (
	SELECT normalized_name, display_name,
		coalesce(nullif(trim(both '-' from regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g')), ''), 'category-' || substr(md5(normalized_name), 1, 12)) AS base_slug
	FROM grouped_names
), ranked_slugs AS (
	SELECT normalized_name, display_name, base_slug,
		row_number() OVER (PARTITION BY base_slug ORDER BY normalized_name) AS collision_rank
	FROM base_slugs
)
INSERT INTO "catalog"."category" ("name", "slug")
SELECT display_name,
	CASE WHEN collision_rank = 1 THEN base_slug
		ELSE base_slug || '-' || md5(normalized_name)
	END
FROM ranked_slugs;
--> statement-breakpoint
UPDATE "catalog"."product" AS product
SET "category_id" = category."id"
FROM "catalog"."category" AS category
WHERE product."category" IS NOT NULL
	AND lower(btrim(product."category")) = lower(btrim(category."name"));
--> statement-breakpoint
UPDATE "catalog"."size_guide" AS guide
SET "category_id" = category."id"
FROM "catalog"."category" AS category
WHERE lower(btrim(guide."category")) = lower(btrim(category."name"));
--> statement-breakpoint
ALTER TABLE "catalog"."product" DROP CONSTRAINT "product_category_nonempty_check";
--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" DROP CONSTRAINT "size_guide_category_nonempty_check";
--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" ALTER COLUMN "category_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog"."category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog"."category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" ADD CONSTRAINT "size_guide_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_uidx" ON "catalog"."category" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "category_parent_order_idx" ON "catalog"."category" USING btree ("parent_id", "sort_order");
--> statement-breakpoint
CREATE INDEX "product_category_id_idx" ON "catalog"."product" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "size_guide_category_id_idx" ON "catalog"."size_guide" USING btree ("category_id");
--> statement-breakpoint
ALTER TABLE "catalog"."product" DROP COLUMN "category";
--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" DROP COLUMN "category";

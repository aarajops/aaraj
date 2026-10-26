DROP INDEX "storefront"."banner_placement_created_at_id_idx";--> statement-breakpoint
ALTER TABLE "storefront"."banner" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ordered_banners AS (
  SELECT
    "id",
    (
      row_number() OVER (
        PARTITION BY "placement"
        ORDER BY "created_at" DESC, "id" DESC
      ) - 1
    )::integer AS "sort_order"
  FROM "storefront"."banner"
)
UPDATE "storefront"."banner" AS banner
SET "sort_order" = ordered_banners."sort_order"
FROM ordered_banners
WHERE banner."id" = ordered_banners."id";--> statement-breakpoint
CREATE INDEX "banner_placement_sort_order_id_idx" ON "storefront"."banner" USING btree ("placement","sort_order","id");

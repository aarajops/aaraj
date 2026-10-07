CREATE TABLE "catalog"."product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"alt_text" text NOT NULL,
	"reason" text NOT NULL,
	"deletion_reason" text,
	"sort_order" integer NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_object_key_check" CHECK ("catalog"."product_media"."object_key" = 'quarantine/' || "catalog"."product_media"."id"::text || '/source'),
	CONSTRAINT "product_media_content_type_check" CHECK ("catalog"."product_media"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "product_media_size_check" CHECK ("catalog"."product_media"."size_bytes" between 1 and 10485760),
	CONSTRAINT "product_media_sha256_check" CHECK ("catalog"."product_media"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "product_media_alt_text_check" CHECK ("catalog"."product_media"."alt_text" = btrim("catalog"."product_media"."alt_text") and length("catalog"."product_media"."alt_text") between 1 and 500),
	CONSTRAINT "product_media_reason_check" CHECK ("catalog"."product_media"."reason" = btrim("catalog"."product_media"."reason") and length("catalog"."product_media"."reason") between 3 and 500),
	CONSTRAINT "product_media_deletion_reason_check" CHECK ("catalog"."product_media"."deletion_reason" is null or ("catalog"."product_media"."deletion_reason" = btrim("catalog"."product_media"."deletion_reason") and length("catalog"."product_media"."deletion_reason") between 3 and 500)),
	CONSTRAINT "product_media_sort_order_check" CHECK ("catalog"."product_media"."sort_order" >= 0),
	CONSTRAINT "product_media_status_check" CHECK ("catalog"."product_media"."status" in ('uploading', 'quarantined', 'deleting', 'deleted')),
	CONSTRAINT "product_media_created_by_check" CHECK ("catalog"."product_media"."created_by" = btrim("catalog"."product_media"."created_by") and length("catalog"."product_media"."created_by") > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_command_uidx" ON "catalog"."product_media" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_product_order_uidx" ON "catalog"."product_media" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_media_variant_idx" ON "catalog"."product_media" USING btree ("variant_id");

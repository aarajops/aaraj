ALTER TABLE "catalog"."product_media" ADD COLUMN "variant_color" text;--> statement-breakpoint
UPDATE "catalog"."product_media" AS media
SET "variant_color" = variant."color"
FROM "catalog"."product_variant" AS variant
WHERE media."variant_id" = variant."id"
  AND media."variant_color" IS NULL;--> statement-breakpoint
CREATE INDEX "product_media_product_color_idx" ON "catalog"."product_media" USING btree ("product_id","variant_color");--> statement-breakpoint
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_variant_color_check" CHECK ("catalog"."product_media"."variant_color" is null or ("catalog"."product_media"."variant_color" = btrim("catalog"."product_media"."variant_color") and length("catalog"."product_media"."variant_color") between 1 and 100));
--> statement-breakpoint
CREATE TABLE "catalog"."product_video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_uid" text,
	"upload_url_ciphertext" text,
	"upload_expires_at" timestamp with time zone,
	"title" text NOT NULL,
	"description" text,
	"variant_color" text,
	"file_size_bytes" integer NOT NULL,
	"duration_seconds" numeric(8, 3),
	"captions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"deletion_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_video_title_check" CHECK ("catalog"."product_video"."title" = btrim("catalog"."product_video"."title") and length("catalog"."product_video"."title") between 1 and 160),
	CONSTRAINT "product_video_description_check" CHECK ("catalog"."product_video"."description" is null or ("catalog"."product_video"."description" = btrim("catalog"."product_video"."description") and length("catalog"."product_video"."description") <= 1000)),
	CONSTRAINT "product_video_color_check" CHECK ("catalog"."product_video"."variant_color" is null or ("catalog"."product_video"."variant_color" = btrim("catalog"."product_video"."variant_color") and length("catalog"."product_video"."variant_color") between 1 and 100)),
	CONSTRAINT "product_video_size_check" CHECK ("catalog"."product_video"."file_size_bytes" between 1 and 536870912),
	CONSTRAINT "product_video_duration_check" CHECK ("catalog"."product_video"."duration_seconds" is null or "catalog"."product_video"."duration_seconds" between 0.001 and 36000),
	CONSTRAINT "product_video_captions_check" CHECK (jsonb_typeof("catalog"."product_video"."captions") = 'array' and jsonb_array_length("catalog"."product_video"."captions") <= 50),
	CONSTRAINT "product_video_sort_order_check" CHECK ("catalog"."product_video"."sort_order" >= 0),
	CONSTRAINT "product_video_status_check" CHECK ("catalog"."product_video"."status" in ('provisioning', 'awaiting_upload', 'processing', 'ready', 'error', 'deleting', 'deleted')),
	CONSTRAINT "product_video_uid_check" CHECK ("catalog"."product_video"."provider_uid" is null or "catalog"."product_video"."provider_uid" ~ '^[A-Za-z0-9_-]{16,128}$'),
	CONSTRAINT "product_video_reason_check" CHECK ("catalog"."product_video"."reason" is null or ("catalog"."product_video"."reason" = btrim("catalog"."product_video"."reason") and length("catalog"."product_video"."reason") between 3 and 500)),
	CONSTRAINT "product_video_deletion_reason_check" CHECK ("catalog"."product_video"."deletion_reason" is null or ("catalog"."product_video"."deletion_reason" = btrim("catalog"."product_video"."deletion_reason") and length("catalog"."product_video"."deletion_reason") between 3 and 500)),
	CONSTRAINT "product_video_created_by_check" CHECK ("catalog"."product_video"."created_by" = btrim("catalog"."product_video"."created_by") and length("catalog"."product_video"."created_by") > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_video_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"provider_uid" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_video_webhook_fingerprint_check" CHECK ("catalog"."product_video_webhook_inbox"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "product_video_webhook_uid_check" CHECK ("catalog"."product_video_webhook_inbox"."provider_uid" ~ '^[A-Za-z0-9_-]{16,128}$'),
	CONSTRAINT "product_video_webhook_payload_check" CHECK (jsonb_typeof("catalog"."product_video_webhook_inbox"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "catalog"."product_video" ADD CONSTRAINT "product_video_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_video_command_uidx" ON "catalog"."product_video" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_video_provider_uidx" ON "catalog"."product_video" USING btree ("provider_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "product_video_product_order_uidx" ON "catalog"."product_video" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_video_product_status_order_idx" ON "catalog"."product_video" USING btree ("product_id","status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_video_webhook_fingerprint_uidx" ON "catalog"."product_video_webhook_inbox" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "product_video_webhook_uid_received_idx" ON "catalog"."product_video_webhook_inbox" USING btree ("provider_uid","received_at");
--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD COLUMN "content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."product" ADD CONSTRAINT "product_content_blocks_check" CHECK (jsonb_typeof("catalog"."product"."content_blocks") = 'array' and jsonb_array_length("catalog"."product"."content_blocks") <= 32);

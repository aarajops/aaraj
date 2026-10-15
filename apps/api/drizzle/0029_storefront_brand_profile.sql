CREATE TABLE "storefront"."brand_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_asset_kind_check" CHECK ("storefront"."brand_asset"."kind" in ('logo', 'favicon')),
	CONSTRAINT "brand_asset_kind_content_type_check" CHECK (("storefront"."brand_asset"."kind" = 'logo' and "storefront"."brand_asset"."content_type" = 'image/webp') or ("storefront"."brand_asset"."kind" = 'favicon' and "storefront"."brand_asset"."content_type" = 'image/png')),
	CONSTRAINT "brand_asset_object_key_check" CHECK ("storefront"."brand_asset"."object_key" ~ '^published/storefront/(logo|favicon)/[0-9a-f-]{36}/[0-9a-f]{64}\.(webp|png)$'),
	CONSTRAINT "brand_asset_source_sha256_check" CHECK ("storefront"."brand_asset"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "brand_asset_sha256_check" CHECK ("storefront"."brand_asset"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "brand_asset_size_check" CHECK ("storefront"."brand_asset"."size_bytes" between 1 and 3145728),
	CONSTRAINT "brand_asset_dimensions_check" CHECK (("storefront"."brand_asset"."kind" = 'logo' and "storefront"."brand_asset"."width" between 1 and 1200 and "storefront"."brand_asset"."height" between 1 and 400) or ("storefront"."brand_asset"."kind" = 'favicon' and "storefront"."brand_asset"."width" = 64 and "storefront"."brand_asset"."height" = 64))
);
--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "business_address" text;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "favicon_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "social_links" jsonb DEFAULT '{"instagram":null,"facebook":null,"tiktok":null,"youtube":null,"x":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "footer_description" text;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "footer_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storefront"."brand_asset" ADD CONSTRAINT "brand_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_asset_command_uidx" ON "storefront"."brand_asset" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_asset_object_key_uidx" ON "storefront"."brand_asset" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_logo_asset_id_brand_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "storefront"."brand_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_favicon_asset_id_brand_asset_id_fk" FOREIGN KEY ("favicon_asset_id") REFERENCES "storefront"."brand_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_support_email_check" CHECK ("storefront"."configuration"."support_email" is null or ("storefront"."configuration"."support_email" = btrim("storefront"."configuration"."support_email") and length("storefront"."configuration"."support_email") <= 254 and "storefront"."configuration"."support_email" ~ '^[^[:space:]@]+@[^[:space:]@]+$'));--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_business_address_check" CHECK ("storefront"."configuration"."business_address" is null or ("storefront"."configuration"."business_address" = btrim("storefront"."configuration"."business_address") and length("storefront"."configuration"."business_address") between 1 and 500));--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_footer_description_check" CHECK ("storefront"."configuration"."footer_description" is null or ("storefront"."configuration"."footer_description" = btrim("storefront"."configuration"."footer_description") and length("storefront"."configuration"."footer_description") between 1 and 500));--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_social_links_check" CHECK (case when jsonb_typeof("storefront"."configuration"."social_links") = 'object' then true else false end);--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_footer_links_check" CHECK (case when jsonb_typeof("storefront"."configuration"."footer_links") = 'array' then jsonb_array_length("storefront"."configuration"."footer_links") <= 8 else false end);
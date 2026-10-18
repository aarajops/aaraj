CREATE TABLE "storefront"."banner_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"publicly_released_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banner_asset_object_key_check" CHECK ("storefront"."banner_asset"."object_key" ~ '^published/storefront/banner/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'),
	CONSTRAINT "banner_asset_source_sha256_check" CHECK ("storefront"."banner_asset"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "banner_asset_sha256_check" CHECK ("storefront"."banner_asset"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "banner_asset_size_check" CHECK ("storefront"."banner_asset"."size_bytes" between 1 and 3145728),
	CONSTRAINT "banner_asset_dimensions_check" CHECK ("storefront"."banner_asset"."width" between 1 and 2560 and "storefront"."banner_asset"."height" between 1 and 1080),
	CONSTRAINT "banner_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "storefront"."banner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"placement" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"desktop_asset_id" uuid,
	"mobile_asset_id" uuid,
	"alt_text" text DEFAULT '' NOT NULL,
	"href" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone,
	"updated_by" text,
	CONSTRAINT "banner_name_check" CHECK ("storefront"."banner"."name" = btrim("storefront"."banner"."name") and length("storefront"."banner"."name") between 1 and 100),
	CONSTRAINT "banner_placement_check" CHECK ("storefront"."banner"."placement" in ('home_hero')),
	CONSTRAINT "banner_assets_check" CHECK (not "storefront"."banner"."active" or "storefront"."banner"."desktop_asset_id" is not null),
	CONSTRAINT "banner_alt_text_check" CHECK ("storefront"."banner"."alt_text" = btrim("storefront"."banner"."alt_text") and length("storefront"."banner"."alt_text") <= 250),
	CONSTRAINT "banner_href_check" CHECK ("storefront"."banner"."href" is null or ("storefront"."banner"."href" = btrim("storefront"."banner"."href") and length("storefront"."banner"."href") between 1 and 2048 and "storefront"."banner"."href" !~ '[[:cntrl:]]' and position(E'\\' in "storefront"."banner"."href") = 0 and ((left("storefront"."banner"."href", 1) = '/' and left("storefront"."banner"."href", 2) <> '//') or "storefront"."banner"."href" ~* '^https://[^/@?#]+(:[0-9]+)?([/?#].*)?$'))),
	CONSTRAINT "banner_version_check" CHECK ("storefront"."banner"."version" > 0),
	CONSTRAINT "banner_update_actor_check" CHECK (("storefront"."banner"."updated_at" is null and "storefront"."banner"."updated_by" is null) or ("storefront"."banner"."updated_at" is not null and "storefront"."banner"."updated_by" is not null)),
	CONSTRAINT "banner_desktop_asset_id_banner_asset_id_fk" FOREIGN KEY ("desktop_asset_id") REFERENCES "storefront"."banner_asset"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "banner_mobile_asset_id_banner_asset_id_fk" FOREIGN KEY ("mobile_asset_id") REFERENCES "storefront"."banner_asset"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "banner_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "banner_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "banner_placement_created_at_id_idx" ON "storefront"."banner" USING btree ("placement","created_at","id");
--> statement-breakpoint
CREATE INDEX "banner_asset_created_at_id_idx" ON "storefront"."banner_asset" USING btree ("created_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "banner_asset_command_uidx" ON "storefront"."banner_asset" USING btree ("command_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "banner_asset_object_key_uidx" ON "storefront"."banner_asset" USING btree ("object_key");

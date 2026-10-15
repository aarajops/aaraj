CREATE SCHEMA "storefront";
--> statement-breakpoint
CREATE TABLE "storefront"."configuration" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"site_name" text DEFAULT 'AARAJ' NOT NULL,
	"announcement_enabled" boolean DEFAULT false NOT NULL,
	"announcement_text" text,
	"support_phone" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by" text,
	CONSTRAINT "configuration_singleton_check" CHECK ("storefront"."configuration"."id" = 'default'),
	CONSTRAINT "configuration_site_name_check" CHECK ("storefront"."configuration"."site_name" = btrim("storefront"."configuration"."site_name") and length("storefront"."configuration"."site_name") between 1 and 80),
	CONSTRAINT "configuration_announcement_text_check" CHECK ("storefront"."configuration"."announcement_text" is null or ("storefront"."configuration"."announcement_text" = btrim("storefront"."configuration"."announcement_text") and length("storefront"."configuration"."announcement_text") between 1 and 160)),
	CONSTRAINT "configuration_announcement_enabled_check" CHECK (not "storefront"."configuration"."announcement_enabled" or "storefront"."configuration"."announcement_text" is not null),
	CONSTRAINT "configuration_support_phone_check" CHECK ("storefront"."configuration"."support_phone" is null or "storefront"."configuration"."support_phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "configuration_version_check" CHECK ("storefront"."configuration"."version" > 0),
	CONSTRAINT "configuration_update_actor_check" CHECK (("storefront"."configuration"."updated_at" is null and "storefront"."configuration"."updated_by" is null) or ("storefront"."configuration"."updated_at" is not null and "storefront"."configuration"."updated_by" is not null))
);
--> statement-breakpoint
INSERT INTO "storefront"."configuration" ("id", "site_name")
VALUES ('default', 'AARAJ');
--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;

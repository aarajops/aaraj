CREATE TABLE "tax"."configuration" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by" text,
	CONSTRAINT "configuration_singleton_check" CHECK ("tax"."configuration"."id" = 'default'),
	CONSTRAINT "configuration_update_actor_check" CHECK (("tax"."configuration"."updated_at" is null and "tax"."configuration"."updated_by" is null) or ("tax"."configuration"."updated_at" is not null and "tax"."configuration"."updated_by" is not null))
);
--> statement-breakpoint
INSERT INTO "tax"."configuration" ("id", "enabled")
VALUES ('default', false);
--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ALTER COLUMN "tax_profile_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ALTER COLUMN "tax_source_reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ALTER COLUMN "tax_source_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ALTER COLUMN "tax_rounding_rule" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tax"."configuration" ADD CONSTRAINT "configuration_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;

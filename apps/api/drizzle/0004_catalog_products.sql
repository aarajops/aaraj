CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE TABLE "catalog"."product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_format_check" CHECK ("catalog"."product"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "product_name_nonempty_check" CHECK ("catalog"."product"."name" = btrim("catalog"."product"."name") AND length("catalog"."product"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_uidx" ON "catalog"."product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_published_updated_idx" ON "catalog"."product" USING btree ("is_published","updated_at");
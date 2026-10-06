CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE TABLE "inventory"."stock_balance" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balance_quantity_nonnegative_check" CHECK ("inventory"."stock_balance"."quantity_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity_delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_delta_nonzero_check" CHECK ("inventory"."stock_movement"."quantity_delta" <> 0),
	CONSTRAINT "stock_movement_result_nonnegative_check" CHECK ("inventory"."stock_movement"."quantity_after" >= 0 AND "inventory"."stock_movement"."quantity_after"::bigint - "inventory"."stock_movement"."quantity_delta"::bigint BETWEEN 0 AND 2147483647),
	CONSTRAINT "stock_movement_reason_nonempty_check" CHECK ("inventory"."stock_movement"."reason" = btrim("inventory"."stock_movement"."reason") AND length("inventory"."stock_movement"."reason") BETWEEN 3 AND 500),
	CONSTRAINT "stock_movement_actor_nonempty_check" CHECK ("inventory"."stock_movement"."actor_id" = btrim("inventory"."stock_movement"."actor_id") AND length("inventory"."stock_movement"."actor_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movement_command_uidx" ON "inventory"."stock_movement" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "stock_movement_variant_created_idx" ON "inventory"."stock_movement" USING btree ("variant_id","created_at","id");

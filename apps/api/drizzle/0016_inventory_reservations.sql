CREATE TABLE "inventory"."reservation_command" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"reservation_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_command_operation_check" CHECK ("inventory"."reservation_command"."operation" in ('reserve', 'release', 'consume')),
	CONSTRAINT "reservation_command_fingerprint_check" CHECK ("inventory"."reservation_command"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservation_status_check" CHECK ("inventory"."stock_reservation"."status" in ('held', 'released', 'consumed'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_reservation_line" (
	"reservation_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "stock_reservation_line_pk" PRIMARY KEY("reservation_id","variant_id"),
	CONSTRAINT "stock_reservation_line_quantity_check" CHECK ("inventory"."stock_reservation_line"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_balance" ADD COLUMN "quantity_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."reservation_command" ADD CONSTRAINT "reservation_command_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "inventory"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "inventory"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_command_reserve_uidx" ON "inventory"."reservation_command" USING btree ("reservation_id") WHERE "inventory"."reservation_command"."operation" = 'reserve';--> statement-breakpoint
ALTER TABLE "inventory"."stock_balance" ADD CONSTRAINT "stock_balance_reserved_quantity_check" CHECK ("inventory"."stock_balance"."quantity_reserved" >= 0 AND "inventory"."stock_balance"."quantity_reserved" <= "inventory"."stock_balance"."quantity_on_hand");
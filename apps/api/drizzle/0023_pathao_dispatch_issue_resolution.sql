CREATE TABLE "delivery"."pathao_webhook_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"action" text NOT NULL,
	"resulting_state" text NOT NULL,
	"reason" text NOT NULL,
	"verified_in_pathao_panel" boolean DEFAULT false NOT NULL,
	"resolved_by" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pathao_webhook_resolution_fingerprint_check" CHECK ("delivery"."pathao_webhook_resolution"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pathao_webhook_resolution_action_check" CHECK (("delivery"."pathao_webhook_resolution"."action" = 'recheck' and "delivery"."pathao_webhook_resolution"."resulting_state" = 'pending' and "delivery"."pathao_webhook_resolution"."verified_in_pathao_panel" = false) or ("delivery"."pathao_webhook_resolution"."action" = 'acknowledge_no_change' and "delivery"."pathao_webhook_resolution"."resulting_state" = 'ignored' and "delivery"."pathao_webhook_resolution"."verified_in_pathao_panel" = true)),
	CONSTRAINT "pathao_webhook_resolution_reason_check" CHECK (length("delivery"."pathao_webhook_resolution"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "orders"."pathao_booking_claim" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_pathao_booking_claim_fingerprint_check" CHECK ("orders"."pathao_booking_claim"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_pathao_booking_claim_status_check" CHECK ("orders"."pathao_booking_claim"."status" in ('submitting', 'booked', 'outcome_unknown', 'reconciliation_required')),
	CONSTRAINT "order_pathao_booking_claim_error_check" CHECK ("orders"."pathao_booking_claim"."last_error_code" is null or "orders"."pathao_booking_claim"."last_error_code" ~ '^PATHAO_[A-Z0-9_]+$')
);
--> statement-breakpoint
ALTER TABLE "delivery"."pathao_booking" DROP CONSTRAINT "pathao_booking_order_id_order_header_id_fk";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "delivery_provider" text;--> statement-breakpoint
ALTER TABLE "delivery"."pathao_webhook_resolution" ADD CONSTRAINT "pathao_webhook_resolution_event_id_pathao_webhook_inbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "delivery"."pathao_webhook_inbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."pathao_booking_claim" ADD CONSTRAINT "pathao_booking_claim_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "orders"."pathao_booking_claim" ("order_id", "command_id", "request_fingerprint", "status", "last_error_code", "created_at", "updated_at")
SELECT "order_id", COALESCE("reconciliation_command_id", "command_id"), COALESCE("reconciliation_fingerprint", "request_fingerprint"), "status", "last_error_code", "created_at", "updated_at"
FROM "delivery"."pathao_booking"
ON CONFLICT ("order_id") DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_webhook_resolution_command_uidx" ON "delivery"."pathao_webhook_resolution" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "pathao_webhook_resolution_event_idx" ON "delivery"."pathao_webhook_resolution" USING btree ("event_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_pathao_booking_claim_command_uidx" ON "orders"."pathao_booking_claim" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "order_pathao_booking_claim_stale_idx" ON "orders"."pathao_booking_claim" USING btree ("created_at","order_id") WHERE "orders"."pathao_booking_claim"."status" = 'submitting';--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_delivery_provider_check" CHECK (("orders"."order_header"."fulfillment_status" = 'dispatched' and ("orders"."order_header"."delivery_provider" is null or "orders"."order_header"."delivery_provider" in ('manual', 'pathao'))) or ("orders"."order_header"."fulfillment_status" <> 'dispatched' and "orders"."order_header"."delivery_provider" is null));
--> statement-breakpoint
CREATE FUNCTION "orders"."guard_pathao_dispatch_claim"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pathao_claim_status text;
BEGIN
  IF OLD."fulfillment_status" <> 'dispatched' AND NEW."fulfillment_status" = 'dispatched' THEN
    SELECT "status" INTO pathao_claim_status
    FROM "orders"."pathao_booking_claim"
    WHERE "order_id" = NEW."id"
    FOR UPDATE;

    IF NEW."delivery_provider" IS NULL
       OR (NEW."delivery_provider" = 'pathao' AND pathao_claim_status IS DISTINCT FROM 'booked')
       OR (NEW."delivery_provider" = 'manual' AND pathao_claim_status IS NOT NULL) THEN
      RAISE EXCEPTION 'Dispatch provider must match the confirmed Pathao booking claim';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_header_pathao_dispatch_guard" BEFORE UPDATE ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."guard_pathao_dispatch_claim"();

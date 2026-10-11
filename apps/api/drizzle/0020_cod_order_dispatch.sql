ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_initial_state_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "dispatch_command_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "dispatch_request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "delivery_operator" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "handoff_reference" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "dispatched_by" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_header_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_dispatch_command_uidx" ON "orders"."order_header" USING btree ("dispatch_command_id");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_initial_state_check" CHECK (("orders"."order_header"."status" <> 'awaiting_confirmation' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'not_started')) and ("orders"."order_header"."status" <> 'confirmed' or ("orders"."order_header"."serviceability" = 'serviceable' and "orders"."order_header"."fulfillment_status" in ('awaiting_dispatch', 'dispatched') and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'rejected' or ("orders"."order_header"."serviceability" = 'unserviceable' and "orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'cancelled' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancellation_reason" = 'serviceability_review_timeout' and "orders"."order_header"."cancelled_at" is not null and "orders"."order_header"."cancelled_at" >= "orders"."order_header"."created_at")) and (("orders"."order_header"."status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is not null and "orders"."order_header"."cancelled_at" is not null) or ("orders"."order_header"."status" <> 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and (("orders"."order_header"."fulfillment_status" = 'dispatched' and "orders"."order_header"."dispatch_command_id" is not null and "orders"."order_header"."dispatch_request_fingerprint" is not null and "orders"."order_header"."dispatch_request_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."delivery_operator" is not null and "orders"."order_header"."delivery_operator" = btrim("orders"."order_header"."delivery_operator") and length("orders"."order_header"."delivery_operator") between 2 and 120 and "orders"."order_header"."dispatched_by" is not null and "orders"."order_header"."dispatched_at" is not null) or ("orders"."order_header"."fulfillment_status" <> 'dispatched' and "orders"."order_header"."dispatch_command_id" is null and "orders"."order_header"."dispatch_request_fingerprint" is null and "orders"."order_header"."delivery_operator" is null and "orders"."order_header"."handoff_reference" is null and "orders"."order_header"."dispatched_by" is null and "orders"."order_header"."dispatched_at" is null)) and ("orders"."order_header"."handoff_reference" is null or ("orders"."order_header"."handoff_reference" = btrim("orders"."order_header"."handoff_reference") and length("orders"."order_header"."handoff_reference") between 1 and 160)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "orders"."protect_order_header_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_status text;
  command_reservation_id uuid;
  command_operation text;
BEGIN
  IF ROW(
    NEW."id", NEW."reference", NEW."customer_id", NEW."guest_cart_hash",
    NEW."guest_access_token_hash", NEW."guest_access_expires_at", NEW."quote_id",
    NEW."cart_revision", NEW."reservation_id", NEW."address_ciphertext",
    NEW."payment_method", NEW."collection_status", NEW."merchandise_gross_bdt",
    NEW."delivery_amount_bdt", NEW."total_bdt", NEW."cod_amount_due_bdt",
    NEW."tax_snapshot", NEW."delivery_snapshot", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."reference", OLD."customer_id", OLD."guest_cart_hash",
    OLD."guest_access_token_hash", OLD."guest_access_expires_at", OLD."quote_id",
    OLD."cart_revision", OLD."reservation_id", OLD."address_ciphertext",
    OLD."payment_method", OLD."collection_status", OLD."merchandise_gross_bdt",
    OLD."delivery_amount_bdt", OLD."total_bdt", OLD."cod_amount_due_bdt",
    OLD."tax_snapshot", OLD."delivery_snapshot", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Order ownership, address and financial snapshots are immutable';
  END IF;

  IF OLD."status" = 'confirmed'
     AND OLD."serviceability" = 'serviceable'
     AND OLD."fulfillment_status" = 'awaiting_dispatch' THEN
    IF NEW."status" <> 'confirmed'
       OR NEW."serviceability" <> 'serviceable'
       OR NEW."fulfillment_status" <> 'dispatched'
       OR OLD."dispatch_command_id" IS NOT NULL
       OR OLD."dispatch_request_fingerprint" IS NOT NULL
       OR OLD."delivery_operator" IS NOT NULL
       OR OLD."handoff_reference" IS NOT NULL
       OR OLD."dispatched_by" IS NOT NULL
       OR OLD."dispatched_at" IS NOT NULL
       OR NEW."dispatch_command_id" IS NULL
       OR NEW."dispatch_request_fingerprint" IS NULL
       OR NEW."delivery_operator" IS NULL
       OR NEW."dispatched_by" IS NULL
       OR NEW."dispatched_at" IS NULL
       OR NEW."dispatched_at" > clock_timestamp() THEN
      RAISE EXCEPTION 'A dispatch must be a complete confirmed COD Order handoff';
    END IF;

    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = NEW."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'The Order reservation must be consumed before dispatch';
    END IF;

    SELECT "reservation_id", "operation"
      INTO command_reservation_id, command_operation
    FROM "inventory"."reservation_command"
    WHERE "command_id" = NEW."dispatch_command_id";
    IF command_reservation_id IS DISTINCT FROM NEW."reservation_id"
       OR command_operation IS DISTINCT FROM 'consume' THEN
      RAISE EXCEPTION 'Dispatch requires its matching durable Inventory consume command';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'awaiting_confirmation'
     OR OLD."serviceability" <> 'pending_manual_review' THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review or confirmed dispatch may transition';
  END IF;
  IF NEW."dispatch_command_id" IS NOT NULL
     OR NEW."dispatch_request_fingerprint" IS NOT NULL
     OR NEW."delivery_operator" IS NOT NULL
     OR NEW."handoff_reference" IS NOT NULL
     OR NEW."dispatched_by" IS NOT NULL
     OR NEW."dispatched_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A pending Order cannot include dispatch evidence';
  END IF;
  IF NEW."status" IN ('confirmed', 'rejected')
     AND OLD."created_at" <= clock_timestamp() - interval '168 hours' THEN
    RAISE EXCEPTION 'Staff serviceability review must be completed before 7 days';
  END IF;
  IF NEW."status" = 'confirmed'
     AND (NEW."serviceability" <> 'serviceable' OR NEW."fulfillment_status" <> 'awaiting_dispatch'
          OR NEW."cancellation_reason" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'A confirmed COD Order must be serviceable and await dispatch';
  END IF;
  IF NEW."status" = 'rejected'
     AND (NEW."serviceability" <> 'unserviceable' OR NEW."fulfillment_status" <> 'cancelled'
          OR NEW."cancellation_reason" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'A rejected COD Order must be unserviceable and cancelled';
  END IF;
  IF NEW."status" = 'cancelled'
     AND (NEW."serviceability" <> 'pending_manual_review'
          OR NEW."fulfillment_status" <> 'cancelled'
          OR NEW."cancellation_reason" <> 'serviceability_review_timeout'
          OR NEW."cancelled_at" IS NULL
          OR NEW."cancelled_at" < NEW."created_at" + interval '168 hours'
          OR NEW."cancelled_at" > clock_timestamp()) THEN
    RAISE EXCEPTION 'A pending COD Order may timeout only after 7 days';
  END IF;
  IF NEW."status" NOT IN ('confirmed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review may transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "orders"."reject_initial_dispatched_order"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."fulfillment_status" = 'dispatched'
     OR NEW."dispatch_command_id" IS NOT NULL
     OR NEW."dispatch_request_fingerprint" IS NOT NULL
     OR NEW."delivery_operator" IS NOT NULL
     OR NEW."handoff_reference" IS NOT NULL
     OR NEW."dispatched_by" IS NOT NULL
     OR NEW."dispatched_at" IS NOT NULL THEN
    RAISE EXCEPTION 'An Order must be dispatched through its guarded transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "order_header_reject_initial_dispatch" BEFORE INSERT ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."reject_initial_dispatched_order"();

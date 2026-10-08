ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_status_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_initial_state_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "order_pending_review_deadline_idx" ON "orders"."order_header" USING btree ("created_at","id") WHERE "status" = 'awaiting_confirmation' and "serviceability" = 'pending_manual_review';--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_status_check" CHECK ("orders"."order_header"."status" in ('awaiting_confirmation', 'confirmed', 'rejected', 'cancelled'));--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_initial_state_check" CHECK (("orders"."order_header"."status" <> 'awaiting_confirmation' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'not_started')) and ("orders"."order_header"."status" <> 'confirmed' or ("orders"."order_header"."serviceability" = 'serviceable' and "orders"."order_header"."fulfillment_status" = 'awaiting_dispatch' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'rejected' or ("orders"."order_header"."serviceability" = 'unserviceable' and "orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'cancelled' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancellation_reason" = 'serviceability_review_timeout' and "orders"."order_header"."cancelled_at" is not null and "orders"."order_header"."cancelled_at" >= "orders"."order_header"."created_at" + interval '48 hours')) and (("orders"."order_header"."status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is not null and "orders"."order_header"."cancelled_at" is not null) or ("orders"."order_header"."status" <> 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)));
CREATE OR REPLACE FUNCTION "orders"."protect_order_header_update"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD."status" <> 'awaiting_confirmation'
     OR OLD."serviceability" <> 'pending_manual_review' THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review may transition';
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
          OR NEW."cancelled_at" < NEW."created_at" + interval '48 hours'
          OR NEW."cancelled_at" > clock_timestamp()) THEN
    RAISE EXCEPTION 'A pending COD Order may timeout only after 48 hours';
  END IF;
  IF NEW."status" NOT IN ('confirmed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review may transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

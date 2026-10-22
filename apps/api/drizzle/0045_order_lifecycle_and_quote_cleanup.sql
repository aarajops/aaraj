ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_initial_state_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_delivery_provider_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_collection_status_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "collected_amount_bdt" bigint;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "collection_reason" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "fulfillment_outcome_reason" text;--> statement-breakpoint
CREATE INDEX "snapshot_expires_idx" ON "quote"."snapshot" USING btree ("expires_at","id");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_collection_amount_status_check" CHECK (("orders"."order_header"."collection_status" = 'collected' and "orders"."order_header"."collected_amount_bdt" is not null and "orders"."order_header"."collected_amount_bdt" = "orders"."order_header"."cod_amount_due_bdt") or ("orders"."order_header"."collection_status" = 'discrepancy' and "orders"."order_header"."collected_amount_bdt" is not null and "orders"."order_header"."collected_amount_bdt" <> "orders"."order_header"."cod_amount_due_bdt") or "orders"."order_header"."collection_status" = 'uncollected');--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_initial_state_check" CHECK (("orders"."order_header"."status" <> 'awaiting_confirmation' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'not_started')) and ("orders"."order_header"."status" <> 'confirmed' or ("orders"."order_header"."serviceability" = 'serviceable' and "orders"."order_header"."fulfillment_status" in ('awaiting_dispatch', 'dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'rejected' or ("orders"."order_header"."serviceability" = 'unserviceable' and "orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and ("orders"."order_header"."status" <> 'cancelled' or ("orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancelled_at" is not null and "orders"."order_header"."cancelled_at" >= "orders"."order_header"."created_at" and (("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."cancellation_reason" = 'serviceability_review_timeout') or ("orders"."order_header"."serviceability" = 'serviceable' and "orders"."order_header"."cancellation_reason" = 'staff_cancelled')))) and (("orders"."order_header"."status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is not null and "orders"."order_header"."cancelled_at" is not null) or ("orders"."order_header"."status" <> 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null)) and (("orders"."order_header"."fulfillment_status" in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."dispatch_command_id" is not null and "orders"."order_header"."dispatch_request_fingerprint" is not null and "orders"."order_header"."dispatch_request_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."delivery_operator" is not null and "orders"."order_header"."delivery_operator" = btrim("orders"."order_header"."delivery_operator") and length("orders"."order_header"."delivery_operator") between 2 and 120 and "orders"."order_header"."dispatched_by" is not null and "orders"."order_header"."dispatched_at" is not null) or ("orders"."order_header"."fulfillment_status" not in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."dispatch_command_id" is null and "orders"."order_header"."dispatch_request_fingerprint" is null and "orders"."order_header"."delivery_operator" is null and "orders"."order_header"."handoff_reference" is null and "orders"."order_header"."dispatched_by" is null and "orders"."order_header"."dispatched_at" is null)) and (("orders"."order_header"."fulfillment_status" in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."fulfillment_outcome_reason" is not null and "orders"."order_header"."fulfillment_outcome_reason" = btrim("orders"."order_header"."fulfillment_outcome_reason") and length("orders"."order_header"."fulfillment_outcome_reason") between 3 and 500) or ("orders"."order_header"."fulfillment_status" not in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."fulfillment_outcome_reason" is null)) and ("orders"."order_header"."handoff_reference" is null or ("orders"."order_header"."handoff_reference" = btrim("orders"."order_header"."handoff_reference") and length("orders"."order_header"."handoff_reference") between 1 and 160)));--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_delivery_provider_check" CHECK (("orders"."order_header"."fulfillment_status" in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and ("orders"."order_header"."delivery_provider" is null or "orders"."order_header"."delivery_provider" in ('manual', 'pathao'))) or ("orders"."order_header"."fulfillment_status" not in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."delivery_provider" is null));--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_collection_status_check" CHECK (("orders"."order_header"."collection_status" = 'uncollected' and "orders"."order_header"."collected_amount_bdt" is null and "orders"."order_header"."collection_reason" is null) or ("orders"."order_header"."collection_status" in ('collected', 'discrepancy') and "orders"."order_header"."collected_amount_bdt" is not null and "orders"."order_header"."collected_amount_bdt" between 0 and 9007199254740991 and "orders"."order_header"."collection_reason" is not null and "orders"."order_header"."collection_reason" = btrim("orders"."order_header"."collection_reason") and length("orders"."order_header"."collection_reason") between 3 and 500));--> statement-breakpoint
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
    NEW."payment_method", NEW."merchandise_gross_bdt", NEW."delivery_amount_bdt",
    NEW."total_bdt", NEW."cod_amount_due_bdt", NEW."delivery_snapshot", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."reference", OLD."customer_id", OLD."guest_cart_hash",
    OLD."guest_access_token_hash", OLD."guest_access_expires_at", OLD."quote_id",
    OLD."cart_revision", OLD."reservation_id", OLD."address_ciphertext",
    OLD."payment_method", OLD."merchandise_gross_bdt", OLD."delivery_amount_bdt",
    OLD."total_bdt", OLD."cod_amount_due_bdt", OLD."delivery_snapshot", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Order ownership, address and financial snapshots are immutable';
  END IF;

  IF OLD."status" = 'confirmed'
     AND OLD."serviceability" = 'serviceable'
     AND OLD."fulfillment_status" = 'awaiting_dispatch' THEN
    IF NEW."status" = 'cancelled' THEN
      IF NEW."serviceability" IS DISTINCT FROM 'serviceable'
         OR NEW."fulfillment_status" IS DISTINCT FROM 'cancelled'
         OR NEW."cancellation_reason" IS DISTINCT FROM 'staff_cancelled'
         OR NEW."cancelled_at" IS NULL
         OR NEW."cancelled_at" < OLD."created_at"
         OR NEW."cancelled_at" > clock_timestamp()
         OR NEW."dispatch_command_id" IS NOT NULL
         OR NEW."dispatch_request_fingerprint" IS NOT NULL
         OR NEW."delivery_provider" IS NOT NULL
         OR NEW."delivery_operator" IS NOT NULL
         OR NEW."handoff_reference" IS NOT NULL
         OR NEW."dispatched_by" IS NOT NULL
         OR NEW."dispatched_at" IS NOT NULL
         OR ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
            IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
        RAISE EXCEPTION 'A pre-dispatch cancellation must preserve Order evidence and payment state';
      END IF;

      IF EXISTS (
        SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
        WHERE claim."order_id" = OLD."id"
      ) THEN
        RAISE EXCEPTION 'A Pathao booking claim must be reconciled before cancellation';
      END IF;

      SELECT "status" INTO reservation_status
      FROM "inventory"."stock_reservation"
      WHERE "id" = OLD."reservation_id"
      FOR UPDATE;
      IF reservation_status IS DISTINCT FROM 'released' THEN
        RAISE EXCEPTION 'The Order reservation must be released before cancellation';
      END IF;
      RETURN NEW;
    END IF;

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
       OR NEW."dispatched_at" > clock_timestamp()
       OR ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
          IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
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

  IF OLD."status" = 'confirmed'
     AND OLD."serviceability" = 'serviceable'
     AND OLD."fulfillment_status" IN ('dispatched', 'partially_delivered', 'delivery_failed')
     AND (NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
          OR NEW."fulfillment_outcome_reason" IS DISTINCT FROM OLD."fulfillment_outcome_reason") THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."serviceability" IS DISTINCT FROM OLD."serviceability"
       OR (OLD."fulfillment_status" = 'dispatched'
           AND NEW."fulfillment_status" NOT IN ('partially_delivered', 'delivered', 'delivery_failed', 'returned'))
       OR (OLD."fulfillment_status" = 'partially_delivered'
           AND NEW."fulfillment_status" NOT IN ('partially_delivered', 'delivered', 'returned'))
       OR (OLD."fulfillment_status" = 'delivery_failed'
           AND NEW."fulfillment_status" NOT IN ('delivery_failed', 'partially_delivered', 'delivered', 'returned'))
       OR ROW(NEW."dispatch_command_id", NEW."dispatch_request_fingerprint", NEW."delivery_provider",
              NEW."delivery_operator", NEW."handoff_reference", NEW."dispatched_by", NEW."dispatched_at")
          IS DISTINCT FROM ROW(OLD."dispatch_command_id", OLD."dispatch_request_fingerprint", OLD."delivery_provider",
              OLD."delivery_operator", OLD."handoff_reference", OLD."dispatched_by", OLD."dispatched_at")
       OR NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason"
       OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
          IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
      RAISE EXCEPTION 'The delivery outcome is not a valid transition for this Order';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'confirmed'
     AND OLD."serviceability" = 'serviceable'
     AND OLD."fulfillment_status" IN ('partially_delivered', 'delivered', 'returned')
     AND ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
         IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."serviceability" IS DISTINCT FROM OLD."serviceability"
       OR NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
       OR NEW."fulfillment_outcome_reason" IS DISTINCT FROM OLD."fulfillment_outcome_reason"
       OR ROW(NEW."dispatch_command_id", NEW."dispatch_request_fingerprint", NEW."delivery_provider",
              NEW."delivery_operator", NEW."handoff_reference", NEW."dispatched_by", NEW."dispatched_at")
          IS DISTINCT FROM ROW(OLD."dispatch_command_id", OLD."dispatch_request_fingerprint", OLD."delivery_provider",
              OLD."delivery_operator", OLD."handoff_reference", OLD."dispatched_by", OLD."dispatched_at")
       OR NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason"
       OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR NEW."collection_status" = 'uncollected' THEN
      RAISE EXCEPTION 'COD reconciliation may only update collection evidence on a completed delivery';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'awaiting_confirmation'
     OR OLD."serviceability" <> 'pending_manual_review' THEN
    RAISE EXCEPTION 'Only a pending review, dispatch, cancellation, delivery outcome or COD reconciliation may transition';
  END IF;
  IF NEW."dispatch_command_id" IS NOT NULL
     OR NEW."dispatch_request_fingerprint" IS NOT NULL
     OR NEW."delivery_provider" IS NOT NULL
     OR NEW."delivery_operator" IS NOT NULL
     OR NEW."handoff_reference" IS NOT NULL
     OR NEW."dispatched_by" IS NOT NULL
     OR NEW."dispatched_at" IS NOT NULL
     OR NEW."fulfillment_outcome_reason" IS NOT NULL
     OR ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
        IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
    RAISE EXCEPTION 'A pending Order cannot include dispatch, delivery, or collection evidence';
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
$$;--> statement-breakpoint
DROP TRIGGER "quote_snapshot_immutable_row" ON "quote"."snapshot";--> statement-breakpoint
CREATE TRIGGER "quote_snapshot_immutable_row" BEFORE UPDATE ON "quote"."snapshot" FOR EACH ROW EXECUTE FUNCTION "quote"."reject_snapshot_mutation"();--> statement-breakpoint
CREATE FUNCTION "quote"."prune_expired_unreferenced"(p_batch_size integer)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH stale AS (
    SELECT snapshot.id
    FROM "quote"."snapshot" AS snapshot
    WHERE snapshot.expires_at <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1
        FROM "orders"."order_header" AS order_header
        WHERE order_header.quote_id = snapshot.id
      )
    ORDER BY snapshot.expires_at ASC, snapshot.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 1), 1), 500)
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM "quote"."snapshot" AS snapshot
    USING stale
    WHERE snapshot.id = stale.id
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "quote"."prune_expired_unreferenced"(integer) FROM PUBLIC;--> statement-breakpoint

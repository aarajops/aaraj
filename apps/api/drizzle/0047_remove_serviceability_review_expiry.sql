DROP INDEX "orders"."order_pending_review_deadline_idx";--> statement-breakpoint
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
  IF NEW."status" NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'A pending COD Order must be confirmed or rejected';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_status_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_initial_state_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_serviceability_check";--> statement-breakpoint
DROP TRIGGER "order_header_protect_update" ON "orders"."order_header";--> statement-breakpoint
DROP TRIGGER "order_line_protect_row" ON "orders"."order_line";--> statement-breakpoint
DROP FUNCTION "orders"."protect_order_header_update"();--> statement-breakpoint
DROP FUNCTION "orders"."protect_order_line_update"();--> statement-breakpoint
UPDATE "orders"."order_header"
SET "status" = 'cancelled',
    "cancellation_reason" = 'staff_cancelled',
    "cancelled_at" = GREATEST("created_at", "updated_at")
WHERE "status" = 'rejected';--> statement-breakpoint
UPDATE "orders"."order_header"
SET "cancellation_reason" = 'staff_cancelled'
WHERE "cancellation_reason" = 'serviceability_review_timeout';--> statement-breakpoint
DROP INDEX "orders"."order_serviceability_created_idx";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP COLUMN "serviceability";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_status_check" CHECK ("orders"."order_header"."status" in ('pending', 'no_answer', 'confirmed', 'on_hold', 'cancelled'));--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_initial_state_check" CHECK (("orders"."order_header"."status" <> 'pending' or "orders"."order_header"."fulfillment_status" = 'not_started')
        and ("orders"."order_header"."status" <> 'no_answer' or "orders"."order_header"."fulfillment_status" = 'not_started')
        and ("orders"."order_header"."status" <> 'on_hold' or "orders"."order_header"."fulfillment_status" in ('not_started', 'awaiting_dispatch'))
        and ("orders"."order_header"."status" <> 'confirmed' or ("orders"."order_header"."fulfillment_status" in ('awaiting_dispatch', 'dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null))
        and ("orders"."order_header"."status" <> 'cancelled' or ("orders"."order_header"."fulfillment_status" = 'cancelled' and "orders"."order_header"."cancelled_at" is not null and "orders"."order_header"."cancelled_at" >= "orders"."order_header"."created_at" and "orders"."order_header"."cancellation_reason" = 'staff_cancelled'))
        and (("orders"."order_header"."status" = 'cancelled' and "orders"."order_header"."cancellation_reason" is not null and "orders"."order_header"."cancelled_at" is not null) or ("orders"."order_header"."status" <> 'cancelled' and "orders"."order_header"."cancellation_reason" is null and "orders"."order_header"."cancelled_at" is null))
        and (("orders"."order_header"."fulfillment_status" in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."dispatch_command_id" is not null and "orders"."order_header"."dispatch_request_fingerprint" is not null and "orders"."order_header"."dispatch_request_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."delivery_operator" is not null and "orders"."order_header"."delivery_operator" = btrim("orders"."order_header"."delivery_operator") and length("orders"."order_header"."delivery_operator") between 2 and 120 and "orders"."order_header"."dispatched_by" is not null and "orders"."order_header"."dispatched_at" is not null) or ("orders"."order_header"."fulfillment_status" not in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."dispatch_command_id" is null and "orders"."order_header"."dispatch_request_fingerprint" is null and "orders"."order_header"."delivery_operator" is null and "orders"."order_header"."handoff_reference" is null and "orders"."order_header"."dispatched_by" is null and "orders"."order_header"."dispatched_at" is null))
        and (("orders"."order_header"."fulfillment_status" in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."fulfillment_outcome_reason" is not null and "orders"."order_header"."fulfillment_outcome_reason" = btrim("orders"."order_header"."fulfillment_outcome_reason") and length("orders"."order_header"."fulfillment_outcome_reason") between 3 and 500) or ("orders"."order_header"."fulfillment_status" not in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and "orders"."order_header"."fulfillment_outcome_reason" is null))
        and ("orders"."order_header"."handoff_reference" is null or ("orders"."order_header"."handoff_reference" = btrim("orders"."order_header"."handoff_reference") and length("orders"."order_header"."handoff_reference") between 1 and 160)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "orders"."protect_order_header_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_status text;
  command_reservation_id uuid;
  command_operation text;
  transition_fields text[];
  line_merchandise_gross_bdt numeric;
  financial_amounts_changed boolean;
  timestamp_only_update boolean;
BEGIN
  IF ROW(
    NEW."id", NEW."reference", NEW."customer_id", NEW."guest_cart_hash",
    NEW."guest_access_token_hash", NEW."guest_access_expires_at", NEW."quote_id",
    NEW."cart_revision", NEW."address_ciphertext",
    NEW."payment_method", NEW."delivery_snapshot", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."reference", OLD."customer_id", OLD."guest_cart_hash",
    OLD."guest_access_token_hash", OLD."guest_access_expires_at", OLD."quote_id",
    OLD."cart_revision", OLD."address_ciphertext",
    OLD."payment_method", OLD."delivery_snapshot", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Order ownership, address and checkout snapshots are immutable';
  END IF;
  financial_amounts_changed := ROW(
    NEW."merchandise_gross_bdt", NEW."delivery_amount_bdt",
    NEW."total_bdt", NEW."cod_amount_due_bdt"
  ) IS DISTINCT FROM ROW(
    OLD."merchandise_gross_bdt", OLD."delivery_amount_bdt",
    OLD."total_bdt", OLD."cod_amount_due_bdt"
  );
  timestamp_only_update := (
       (OLD."status" = 'pending'
        AND OLD."fulfillment_status" = 'not_started')
       OR (OLD."status" = 'confirmed'
           AND OLD."fulfillment_status" = 'awaiting_dispatch')
     )
     AND NEW."updated_at" IS DISTINCT FROM OLD."updated_at"
     AND NEW."updated_at" >= OLD."updated_at"
     AND NEW."updated_at" <= clock_timestamp()
     AND (to_jsonb(NEW) - ARRAY['updated_at'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at']);
  IF financial_amounts_changed THEN
    transition_fields := ARRAY[
      'merchandise_gross_bdt', 'total_bdt', 'cod_amount_due_bdt', 'updated_at'
    ];
    IF (to_jsonb(NEW) - transition_fields)
       IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
      RAISE EXCEPTION 'An Order item addition cannot change other Order details';
    END IF;
    IF NEW."delivery_amount_bdt" IS DISTINCT FROM OLD."delivery_amount_bdt"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
       OR NOT (
         (OLD."status" = 'pending'
          AND OLD."fulfillment_status" = 'not_started')
         OR (OLD."status" = 'confirmed'
             AND OLD."fulfillment_status" = 'awaiting_dispatch')
       )
       OR NEW."collection_status" <> 'uncollected'
       OR NEW."collected_amount_bdt" IS NOT NULL THEN
      RAISE EXCEPTION 'Order items can only change before courier booking or collection';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
      WHERE claim."order_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'A Pathao booking claim must be resolved before changing Order items';
    END IF;

    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'An editable Order must retain its held stock reservation';
    END IF;

  ELSIF timestamp_only_update THEN
    IF NEW."collection_status" <> 'uncollected'
       OR NEW."collected_amount_bdt" IS NOT NULL THEN
      RAISE EXCEPTION 'Order items can only change before collection';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
      WHERE claim."order_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'A Pathao booking claim must be resolved before changing Order items';
    END IF;

    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'An editable Order must retain its held stock reservation';
    END IF;
  END IF;

  IF financial_amounts_changed OR timestamp_only_update THEN
    SELECT COALESCE(SUM(line."gross_amount_bdt"), 0)
      INTO line_merchandise_gross_bdt
    FROM "orders"."order_line" AS line
    WHERE line."order_id" = NEW."id";
    IF NEW."merchandise_gross_bdt"::numeric IS DISTINCT FROM line_merchandise_gross_bdt
       OR NEW."total_bdt"::numeric IS DISTINCT FROM NEW."merchandise_gross_bdt"::numeric + NEW."delivery_amount_bdt"::numeric
       OR NEW."cod_amount_due_bdt" IS DISTINCT FROM NEW."total_bdt" THEN
      RAISE EXCEPTION 'Order amounts must match the saved item lines and delivery amount';
    END IF;
    IF (SELECT COUNT(*) FROM "orders"."order_line" AS line WHERE line."order_id" = NEW."id") > 50 THEN
      RAISE EXCEPTION 'An Order cannot contain more than 50 item lines';
    END IF;

    IF EXISTS (
      SELECT line."variant_id", SUM(line."quantity")::bigint
      FROM "orders"."order_line" AS line
      WHERE line."order_id" = NEW."id"
      GROUP BY line."variant_id"
      EXCEPT
      SELECT reservation_line."variant_id", reservation_line."quantity"::bigint
      FROM "inventory"."stock_reservation_line" AS reservation_line
      WHERE reservation_line."reservation_id" = NEW."reservation_id"
    ) OR EXISTS (
      SELECT reservation_line."variant_id", reservation_line."quantity"::bigint
      FROM "inventory"."stock_reservation_line" AS reservation_line
      WHERE reservation_line."reservation_id" = NEW."reservation_id"
      EXCEPT
      SELECT line."variant_id", SUM(line."quantity")::bigint
      FROM "orders"."order_line" AS line
      WHERE line."order_id" = NEW."id"
      GROUP BY line."variant_id"
    ) THEN
      RAISE EXCEPTION 'Order item lines must match the held stock reservation';
    END IF;
  END IF;
  IF NEW."reservation_id" IS DISTINCT FROM OLD."reservation_id"
     AND NOT (OLD."status" = 'cancelled' AND NEW."status" = 'pending') THEN
    RAISE EXCEPTION 'An Order reservation can only change when reopening a cancelled Order';
  END IF;
  IF financial_amounts_changed OR timestamp_only_update THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'confirmed'
     AND OLD."fulfillment_status" = 'awaiting_dispatch' THEN
    IF NEW."status" = 'cancelled' THEN
      IF NEW."fulfillment_status" IS DISTINCT FROM 'cancelled'
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

    IF NEW."status" = 'on_hold' THEN
      transition_fields := ARRAY['status', 'updated_at'];
      IF NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
         OR NEW."cancellation_reason" IS NOT NULL
         OR NEW."cancelled_at" IS NOT NULL
         OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
        RAISE EXCEPTION 'A confirmed Order can only be put on hold before dispatch';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
        WHERE claim."order_id" = OLD."id"
      ) THEN
        RAISE EXCEPTION 'A Pathao booking claim must be reconciled before putting this Order on hold';
      END IF;
      SELECT "status" INTO reservation_status
      FROM "inventory"."stock_reservation"
      WHERE "id" = OLD."reservation_id"
      FOR UPDATE;
      IF reservation_status IS DISTINCT FROM 'held' THEN
        RAISE EXCEPTION 'An Order on hold must retain its stock reservation';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW."status" <> 'confirmed'
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
     AND OLD."fulfillment_status" IN ('dispatched', 'partially_delivered', 'delivery_failed')
     AND (NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
          OR NEW."fulfillment_outcome_reason" IS DISTINCT FROM OLD."fulfillment_outcome_reason") THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
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
     AND OLD."fulfillment_status" IN ('partially_delivered', 'delivered', 'returned')
     AND ROW(NEW."collection_status", NEW."collected_amount_bdt", NEW."collection_reason")
         IS DISTINCT FROM ROW(OLD."collection_status", OLD."collected_amount_bdt", OLD."collection_reason") THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
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

  IF OLD."status" = 'cancelled' THEN
    transition_fields := ARRAY['status', 'fulfillment_status', 'reservation_id', 'cancellation_reason', 'cancelled_at', 'updated_at'];
    IF NEW."status" <> 'pending'
       OR NEW."fulfillment_status" <> 'not_started'
       OR NEW."reservation_id" = OLD."reservation_id"
       OR NEW."cancellation_reason" IS NOT NULL
       OR NEW."cancelled_at" IS NOT NULL
       OR NEW."updated_at" < OLD."updated_at"
       OR NEW."updated_at" > clock_timestamp()
       OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
      RAISE EXCEPTION 'A cancelled Order can only be reopened for customer confirmation with a new stock reservation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
      WHERE claim."order_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'A Pathao booking claim must be reconciled before reopening this Order';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'released' THEN
      RAISE EXCEPTION 'A cancelled Order must have a released reservation before reopening';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = NEW."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'A reopened Order must have a new held reservation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" NOT IN ('pending', 'no_answer', 'on_hold') THEN
    RAISE EXCEPTION 'Only a pending review, dispatch, cancellation, delivery outcome or COD reconciliation may transition';
  END IF;
  IF OLD."status" IN ('pending', 'no_answer')
     AND OLD."fulfillment_status" <> 'not_started' THEN
    RAISE EXCEPTION 'A pending Order must await manual review';
  END IF;
  IF OLD."status" = 'on_hold'
     AND OLD."fulfillment_status" NOT IN ('not_started', 'awaiting_dispatch') THEN
    RAISE EXCEPTION 'An Order on hold must preserve its pre-dispatch state';
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
  IF NEW."updated_at" < OLD."updated_at"
     OR NEW."updated_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'Order status timestamp is invalid';
  END IF;

  IF NEW."status" = 'no_answer' THEN
    transition_fields := ARRAY['status', 'updated_at'];
    IF OLD."status" <> 'pending'
       OR OLD."fulfillment_status" <> 'not_started'
       OR NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
       OR NEW."cancellation_reason" IS NOT NULL
       OR NEW."cancelled_at" IS NOT NULL
       OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
      RAISE EXCEPTION 'Only a pending Order can be marked no answer';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'An unanswered Order must retain its stock reservation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'on_hold' THEN
    transition_fields := ARRAY['status', 'updated_at'];
    IF OLD."status" NOT IN ('pending', 'no_answer')
       OR NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status"
       OR NEW."cancellation_reason" IS NOT NULL
       OR NEW."cancelled_at" IS NOT NULL
       OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
      RAISE EXCEPTION 'Only an Order awaiting customer confirmation can be put on hold';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'An Order on hold must retain its stock reservation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'confirmed' THEN
    transition_fields := ARRAY['status', 'fulfillment_status', 'updated_at'];
    IF NEW."fulfillment_status" <> 'awaiting_dispatch'
       OR NEW."cancellation_reason" IS NOT NULL
       OR NEW."cancelled_at" IS NOT NULL
       OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
      RAISE EXCEPTION 'A confirmed COD Order must await dispatch';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = OLD."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'A confirmed Order must retain its stock reservation until dispatch';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
      WHERE claim."order_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'A Pathao booking claim must be reconciled before confirming this Order';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'cancelled' THEN
    transition_fields := ARRAY['status', 'fulfillment_status', 'cancellation_reason', 'cancelled_at', 'updated_at'];
    IF NEW."fulfillment_status" <> 'cancelled'
       OR NEW."cancellation_reason" IS DISTINCT FROM 'staff_cancelled'
       OR NEW."cancelled_at" IS NULL
       OR NEW."cancelled_at" < OLD."created_at"
       OR NEW."cancelled_at" > clock_timestamp()
       OR (to_jsonb(NEW) - transition_fields) IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
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

  RAISE EXCEPTION 'Invalid manual Order status transition';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "order_header_protect_update" BEFORE UPDATE ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_header_update"();
--> statement-breakpoint
CREATE FUNCTION "orders"."protect_order_line_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
  order_fulfillment_status text;
  order_collection_status text;
  order_collected_amount_bdt bigint;
  reservation_id uuid;
  reservation_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Order item snapshots cannot be deleted';
  END IF;
  IF ROW(
    NEW."id", NEW."order_id", NEW."variant_id", NEW."unit_price_bdt",
    NEW."product_snapshot"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."order_id", OLD."variant_id", OLD."unit_price_bdt",
    OLD."product_snapshot"
  ) OR NEW."quantity" <= OLD."quantity"
     OR NEW."gross_amount_bdt"::numeric IS DISTINCT FROM NEW."unit_price_bdt"::numeric * NEW."quantity"::numeric THEN
    RAISE EXCEPTION 'An Order item can only increase its quantity without changing its saved price or product details';
  END IF;

  SELECT order_row."status", order_row."fulfillment_status",
         order_row."collection_status", order_row."collected_amount_bdt",
         order_row."reservation_id"
    INTO order_status, order_fulfillment_status, order_collection_status,
         order_collected_amount_bdt, reservation_id
  FROM "orders"."order_header" AS order_row
  WHERE order_row."id" = OLD."order_id"
  FOR UPDATE;
  IF NOT (
       (order_status = 'pending'
        AND order_fulfillment_status = 'not_started')
       OR (order_status = 'confirmed'
           AND order_fulfillment_status = 'awaiting_dispatch')
     )
     OR order_collection_status IS DISTINCT FROM 'uncollected'
     OR order_collected_amount_bdt IS NOT NULL THEN
    RAISE EXCEPTION 'Order quantities can only increase while pending or confirmed, before dispatch or collection';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
    WHERE claim."order_id" = OLD."order_id"
  ) THEN
    RAISE EXCEPTION 'Order quantities cannot change while a Pathao consignment exists';
  END IF;

  SELECT "status" INTO reservation_status
  FROM "inventory"."stock_reservation"
  WHERE "id" = reservation_id
  FOR UPDATE;
  IF reservation_status IS DISTINCT FROM 'held' THEN
    RAISE EXCEPTION 'An Order quantity can only increase while its stock reservation is held';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_line_protect_row" BEFORE UPDATE OR DELETE ON "orders"."order_line" FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_line_update"();

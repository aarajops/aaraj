DO $$
DECLARE
  function_definition text;
  marker text := $marker$    IF NEW."status" <> 'confirmed'
       OR NEW."fulfillment_status" <> 'dispatched'$marker$;
  return_to_pending text := $transition$
    IF NEW."status" = 'pending' THEN
      transition_fields := ARRAY['status', 'fulfillment_status', 'updated_at'];
      IF NEW."fulfillment_status" IS DISTINCT FROM 'not_started'
         OR NEW."cancellation_reason" IS NOT NULL
         OR NEW."cancelled_at" IS NOT NULL
         OR NEW."updated_at" < OLD."updated_at"
         OR NEW."updated_at" > clock_timestamp()
         OR (to_jsonb(NEW) - transition_fields)
            IS DISTINCT FROM (to_jsonb(OLD) - transition_fields) THEN
        RAISE EXCEPTION 'A confirmed Order can only return to pending before dispatch';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
        WHERE claim."order_id" = OLD."id"
      ) THEN
        RAISE EXCEPTION 'A Pathao booking claim must be reconciled before returning this Order to pending';
      END IF;
      SELECT "status" INTO reservation_status
      FROM "inventory"."stock_reservation"
      WHERE "id" = OLD."reservation_id"
      FOR UPDATE;
      IF reservation_status IS DISTINCT FROM 'held' THEN
        RAISE EXCEPTION 'An Order returned to pending must retain its held reservation';
      END IF;
      RETURN NEW;
    END IF;

$transition$;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;

  IF position(marker IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard does not match the expected dispatch transition';
  END IF;

  function_definition := replace(
    function_definition,
    marker,
    return_to_pending || marker
  );
  EXECUTE function_definition;
END;
$$;

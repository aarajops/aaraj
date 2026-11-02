CREATE OR REPLACE FUNCTION "orders"."protect_order_line_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
  order_fulfillment_status text;
  order_collection_status text;
  order_collected_amount_bdt bigint;
  order_reservation_id uuid;
  reservation_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT order_row."status", order_row."fulfillment_status",
           order_row."collection_status", order_row."collected_amount_bdt",
           order_row."reservation_id"
      INTO order_status, order_fulfillment_status, order_collection_status,
           order_collected_amount_bdt, order_reservation_id
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
      RAISE EXCEPTION 'Order items can only be removed while pending or confirmed, before dispatch or collection';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "orders"."pathao_booking_claim" AS claim
      WHERE claim."order_id" = OLD."order_id"
    ) THEN
      RAISE EXCEPTION 'Order items cannot be removed while a Pathao consignment exists';
    END IF;
    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = order_reservation_id
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'An Order item can only be removed while its stock reservation is held';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "inventory"."stock_reservation_line" AS reservation_line
      WHERE reservation_line."reservation_id" = order_reservation_id
        AND reservation_line."variant_id" = OLD."variant_id"
    ) THEN
      RAISE EXCEPTION 'The Order item stock reservation must be released before removal';
    END IF;
    IF (
      SELECT COUNT(*) FROM "orders"."order_line" AS order_line
      WHERE order_line."order_id" = OLD."order_id"
    ) <= 1 THEN
      RAISE EXCEPTION 'An Order must retain at least one item';
    END IF;
    RETURN OLD;
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
         order_collected_amount_bdt, order_reservation_id
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
  WHERE "id" = order_reservation_id
  FOR UPDATE;
  IF reservation_status IS DISTINCT FROM 'held' THEN
    RAISE EXCEPTION 'An Order quantity can only increase while its stock reservation is held';
  END IF;
  RETURN NEW;
END;
$$;

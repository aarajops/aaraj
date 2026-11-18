ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_amount_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_amount_check" CHECK ("orders"."order_header"."merchandise_gross_bdt" between 0 and 9007199254740991 and "orders"."order_header"."manual_discount_bdt" between 0 and "orders"."order_header"."merchandise_gross_bdt" and "orders"."order_header"."delivery_amount_bdt" between 1 and 9007199254740991 and "orders"."order_header"."total_bdt" between 1 and 9007199254740991 and "orders"."order_header"."cod_amount_due_bdt" between 0 and 9007199254740991 and "orders"."order_header"."total_bdt" = "orders"."order_header"."merchandise_gross_bdt" + "orders"."order_header"."delivery_amount_bdt" - "orders"."order_header"."manual_discount_bdt");--> statement-breakpoint
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
  INTO function_definition;

  IF position(
    '       OR NEW."cod_amount_due_bdt" > NEW."total_bdt" THEN'
    IN function_definition
  ) = 0 THEN
    RAISE EXCEPTION 'Order update guard does not match the expected combo COD definition';
  END IF;

  function_definition := replace(
    function_definition,
    '       OR NEW."cod_amount_due_bdt" > NEW."total_bdt" THEN',
    '       THEN'
  );

  EXECUTE function_definition;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "orders"."protect_order_header_initial_cod"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cod_amount_due_bdt" IS DISTINCT FROM NEW."total_bdt" THEN
    RAISE EXCEPTION 'A new Order COD amount must match its saved total';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_header_protect_initial_cod" BEFORE INSERT ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_header_initial_cod"();

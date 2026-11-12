ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_amount_check";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "manual_discount_bdt" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;

  IF position('NEW."merchandise_gross_bdt", NEW."delivery_amount_bdt"' IN function_definition) = 0
     OR position('OLD."merchandise_gross_bdt", OLD."delivery_amount_bdt"' IN function_definition) = 0
     OR position('NEW."total_bdt"::numeric IS DISTINCT FROM NEW."merchandise_gross_bdt"::numeric + NEW."delivery_amount_bdt"::numeric' IN function_definition) = 0
     OR position('''merchandise_gross_bdt'', ''total_bdt'', ''cod_amount_due_bdt'', ''updated_at''' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard does not match the expected definition';
  END IF;

  function_definition := replace(
    function_definition,
    'NEW."merchandise_gross_bdt", NEW."delivery_amount_bdt"',
    'NEW."merchandise_gross_bdt", NEW."manual_discount_bdt", NEW."delivery_amount_bdt"'
  );
  function_definition := replace(
    function_definition,
    'OLD."merchandise_gross_bdt", OLD."delivery_amount_bdt"',
    'OLD."merchandise_gross_bdt", OLD."manual_discount_bdt", OLD."delivery_amount_bdt"'
  );
  function_definition := replace(
    function_definition,
    '''merchandise_gross_bdt'', ''total_bdt'', ''cod_amount_due_bdt'', ''updated_at''',
    '''merchandise_gross_bdt'', ''manual_discount_bdt'', ''total_bdt'', ''cod_amount_due_bdt'', ''updated_at'''
  );
  function_definition := replace(
    function_definition,
    'NEW."total_bdt"::numeric IS DISTINCT FROM NEW."merchandise_gross_bdt"::numeric + NEW."delivery_amount_bdt"::numeric',
    'NEW."total_bdt"::numeric IS DISTINCT FROM NEW."merchandise_gross_bdt"::numeric + NEW."delivery_amount_bdt"::numeric - NEW."manual_discount_bdt"::numeric'
  );
  function_definition := replace(
    function_definition,
    'An Order item addition cannot change other Order details',
    'An Order amount update cannot change other Order details'
  );
  function_definition := replace(
    function_definition,
    'Order items can only change before courier booking or collection',
    'Order amounts can only change before courier booking or collection'
  );
  function_definition := replace(
    function_definition,
    'A Pathao booking claim must be resolved before changing Order items',
    'A Pathao booking claim must be resolved before changing Order amounts'
  );
  function_definition := replace(
    function_definition,
    'Order amounts must match the saved item lines and delivery amount',
    'Order amounts must match saved item lines, discount, and delivery amount'
  );

  IF position('NEW."manual_discount_bdt"' IN function_definition) = 0
     OR position('OLD."manual_discount_bdt"' IN function_definition) = 0
     OR position('- NEW."manual_discount_bdt"::numeric' IN function_definition) = 0
     OR position('''merchandise_gross_bdt'', ''manual_discount_bdt'', ''total_bdt'', ''cod_amount_due_bdt'', ''updated_at''' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Order update guard could not be updated for manual discounts';
  END IF;

  EXECUTE function_definition;
END;
$$;
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_amount_check" CHECK ("orders"."order_header"."merchandise_gross_bdt" between 0 and 9007199254740991 and "orders"."order_header"."manual_discount_bdt" between 0 and "orders"."order_header"."merchandise_gross_bdt" and "orders"."order_header"."delivery_amount_bdt" between 1 and 9007199254740991 and "orders"."order_header"."total_bdt" between 1 and 9007199254740991 and "orders"."order_header"."cod_amount_due_bdt" = "orders"."order_header"."total_bdt" and "orders"."order_header"."total_bdt" = "orders"."order_header"."merchandise_gross_bdt" + "orders"."order_header"."delivery_amount_bdt" - "orders"."order_header"."manual_discount_bdt");

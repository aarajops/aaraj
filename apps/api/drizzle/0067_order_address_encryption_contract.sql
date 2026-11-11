DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;
  function_definition := replace(
    function_definition,
    'NEW."address_snapshot"',
    'NEW."address_ciphertext", NEW."address_name_prefixes", NEW."address_phone_prefixes"'
  );
  function_definition := replace(
    function_definition,
    'OLD."address_snapshot"',
    'OLD."address_ciphertext", OLD."address_name_prefixes", OLD."address_phone_prefixes"'
  );
  IF position('"address_snapshot"' IN function_definition) > 0 THEN
    RAISE EXCEPTION 'The Order address immutability trigger could not be migrated';
  END IF;
  EXECUTE function_definition;
END;
$$;--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_address_snapshot_check";--> statement-breakpoint
DROP INDEX "orders"."order_address_name_prefix_idx";--> statement-breakpoint
DROP INDEX "orders"."order_address_phone_prefix_idx";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ALTER COLUMN "address_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ALTER COLUMN "address_name_prefixes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ALTER COLUMN "address_phone_prefixes" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "order_address_name_prefix_idx" ON "orders"."order_header" USING gin ("address_name_prefixes");--> statement-breakpoint
CREATE INDEX "order_address_phone_prefix_idx" ON "orders"."order_header" USING gin ("address_phone_prefixes");--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP COLUMN "address_snapshot";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_address_ciphertext_check" CHECK ("orders"."order_header"."address_ciphertext" ~ '^v2\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$' and length("orders"."order_header"."address_ciphertext") between 46 and 8192);--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_address_name_prefixes_check" CHECK (cardinality("orders"."order_header"."address_name_prefixes") between 1 and 120 and array_to_string("orders"."order_header"."address_name_prefixes", ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$');--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_address_phone_prefixes_check" CHECK (cardinality("orders"."order_header"."address_phone_prefixes") = 13 and array_to_string("orders"."order_header"."address_phone_prefixes", ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$');

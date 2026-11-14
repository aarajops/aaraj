DROP INDEX IF EXISTS "orders"."order_address_name_prefix_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "orders"."order_address_phone_prefix_idx";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "address_search_tokens" text[];--> statement-breakpoint
CREATE INDEX "order_address_search_tokens_gin_idx" ON "orders"."order_header" USING gin ("address_search_tokens");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_address_search_tokens_check" CHECK (cardinality("address_search_tokens") > 0) NOT VALID;--> statement-breakpoint
CREATE FUNCTION "orders"."protect_order_address_search_tokens"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."address_search_tokens" IS DISTINCT FROM OLD."address_search_tokens" THEN
    RAISE EXCEPTION 'Order address search tokens are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_address_search_tokens_protect_update" BEFORE UPDATE OF "address_search_tokens" ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_address_search_tokens"();

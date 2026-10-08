CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE TABLE "orders"."order_header" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text,
	"guest_cart_hash" text,
	"guest_access_token_hash" text,
	"guest_access_expires_at" timestamp with time zone,
	"quote_id" uuid NOT NULL,
	"cart_revision" bigint NOT NULL,
	"reservation_id" uuid NOT NULL,
	"address_ciphertext" text NOT NULL,
	"status" text NOT NULL,
	"serviceability" text NOT NULL,
	"payment_method" text DEFAULT 'cod' NOT NULL,
	"collection_status" text DEFAULT 'uncollected' NOT NULL,
	"fulfillment_status" text NOT NULL,
	"merchandise_gross_bdt" bigint NOT NULL,
	"delivery_amount_bdt" bigint NOT NULL,
	"total_bdt" bigint NOT NULL,
	"cod_amount_due_bdt" bigint NOT NULL,
	"tax_snapshot" jsonb NOT NULL,
	"delivery_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_reference_check" CHECK ("orders"."order_header"."reference" ~ '^AA-[0-9A-F]{12}$'),
	CONSTRAINT "order_owner_check" CHECK (("orders"."order_header"."customer_id" is not null and "orders"."order_header"."guest_cart_hash" is null and "orders"."order_header"."guest_access_token_hash" is null and "orders"."order_header"."guest_access_expires_at" is null) or ("orders"."order_header"."customer_id" is null and "orders"."order_header"."guest_cart_hash" is not null and "orders"."order_header"."guest_cart_hash" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."guest_access_token_hash" is not null and "orders"."order_header"."guest_access_token_hash" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."guest_access_expires_at" is not null and "orders"."order_header"."guest_access_expires_at" = "orders"."order_header"."created_at" + interval '30 days')),
	CONSTRAINT "order_guest_token_hash_check" CHECK ("orders"."order_header"."guest_access_token_hash" is null or "orders"."order_header"."guest_access_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_cart_revision_check" CHECK ("orders"."order_header"."cart_revision" between 0 and 9007199254740991),
	CONSTRAINT "order_status_check" CHECK ("orders"."order_header"."status" in ('awaiting_confirmation', 'confirmed', 'rejected')),
	CONSTRAINT "order_serviceability_check" CHECK ("orders"."order_header"."serviceability" in ('pending_manual_review', 'serviceable', 'unserviceable')),
	CONSTRAINT "order_initial_state_check" CHECK (("orders"."order_header"."status" <> 'awaiting_confirmation' or ("orders"."order_header"."serviceability" = 'pending_manual_review' and "orders"."order_header"."fulfillment_status" = 'not_started')) and ("orders"."order_header"."status" <> 'confirmed' or ("orders"."order_header"."serviceability" = 'serviceable' and "orders"."order_header"."fulfillment_status" = 'awaiting_dispatch')) and ("orders"."order_header"."status" <> 'rejected' or ("orders"."order_header"."serviceability" = 'unserviceable' and "orders"."order_header"."fulfillment_status" = 'cancelled'))),
	CONSTRAINT "order_cod_method_check" CHECK ("orders"."order_header"."payment_method" = 'cod'),
	CONSTRAINT "order_collection_status_check" CHECK ("orders"."order_header"."collection_status" = 'uncollected'),
	CONSTRAINT "order_amount_check" CHECK ("orders"."order_header"."merchandise_gross_bdt" between 0 and 9007199254740991 and "orders"."order_header"."delivery_amount_bdt" between 1 and 9007199254740991 and "orders"."order_header"."total_bdt" between 1 and 9007199254740991 and "orders"."order_header"."cod_amount_due_bdt" = "orders"."order_header"."total_bdt" and "orders"."order_header"."total_bdt" = "orders"."order_header"."merchandise_gross_bdt" + "orders"."order_header"."delivery_amount_bdt"),
	CONSTRAINT "order_snapshot_object_check" CHECK (jsonb_typeof("orders"."order_header"."tax_snapshot") = 'object' and jsonb_typeof("orders"."order_header"."delivery_snapshot") = 'object'),
	CONSTRAINT "order_address_ciphertext_check" CHECK ("orders"."order_header"."address_ciphertext" like 'v1.%')
);
--> statement-breakpoint
CREATE TABLE "orders"."order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_bdt" bigint NOT NULL,
	"gross_amount_bdt" bigint NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	CONSTRAINT "order_line_quantity_check" CHECK ("orders"."order_line"."quantity" between 1 and 10),
	CONSTRAINT "order_line_amount_check" CHECK ("orders"."order_line"."unit_price_bdt" between 0 and 9007199254740991 and "orders"."order_line"."gross_amount_bdt" between 0 and 9007199254740991 and "orders"."order_line"."gross_amount_bdt" = "orders"."order_line"."unit_price_bdt" * "orders"."order_line"."quantity"),
	CONSTRAINT "order_line_snapshot_object_check" CHECK (jsonb_typeof("orders"."order_line"."product_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "orders"."idempotency" (
	"owner_hash" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_idempotency_owner_hash_check" CHECK ("orders"."idempotency"."owner_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_idempotency_key_hash_check" CHECK ("orders"."idempotency"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_idempotency_fingerprint_check" CHECK ("orders"."idempotency"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_header_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_header_quote_id_snapshot_id_fk" FOREIGN KEY ("quote_id") REFERENCES "quote"."snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_header_reservation_id_stock_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "inventory"."stock_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_line" ADD CONSTRAINT "order_line_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."idempotency" ADD CONSTRAINT "idempotency_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_reference_uidx" ON "orders"."order_header" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "order_quote_uidx" ON "orders"."order_header" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "order_customer_created_idx" ON "orders"."order_header" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_created_idx" ON "orders"."order_header" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "order_serviceability_created_idx" ON "orders"."order_header" USING btree ("serviceability","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_order_variant_uidx" ON "orders"."order_line" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_line_variant_idx" ON "orders"."order_line" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_owner_key_uidx" ON "orders"."idempotency" USING btree ("owner_hash","key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_order_uidx" ON "orders"."idempotency" USING btree ("order_id");
--> statement-breakpoint
CREATE FUNCTION "orders"."protect_order_header_update"() RETURNS trigger LANGUAGE plpgsql AS $$
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
     OR OLD."serviceability" <> 'pending_manual_review'
     OR NEW."status" NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review may transition';
  END IF;
  IF NEW."status" = 'confirmed'
     AND (NEW."serviceability" <> 'serviceable' OR NEW."fulfillment_status" <> 'awaiting_dispatch') THEN
    RAISE EXCEPTION 'A confirmed COD Order must be serviceable and await dispatch';
  END IF;
  IF NEW."status" = 'rejected'
     AND (NEW."serviceability" <> 'unserviceable' OR NEW."fulfillment_status" <> 'cancelled') THEN
    RAISE EXCEPTION 'A rejected COD Order must be unserviceable and cancelled';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "order_header_protect_update" BEFORE UPDATE ON "orders"."order_header" FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_header_update"();
--> statement-breakpoint
CREATE FUNCTION "orders"."reject_snapshot_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order snapshots are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "order_line_immutable_row" BEFORE UPDATE OR DELETE ON "orders"."order_line" FOR EACH ROW EXECUTE FUNCTION "orders"."reject_snapshot_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_line_immutable_truncate" BEFORE TRUNCATE ON "orders"."order_line" FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_snapshot_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_idempotency_immutable_row" BEFORE UPDATE OR DELETE ON "orders"."idempotency" FOR EACH ROW EXECUTE FUNCTION "orders"."reject_snapshot_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_idempotency_immutable_truncate" BEFORE TRUNCATE ON "orders"."idempotency" FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_snapshot_mutation"();

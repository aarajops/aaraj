CREATE TABLE IF NOT EXISTS "orders"."checkout_call_suppression" (
  "phone_hash" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders"."checkout_draft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_hash" text NOT NULL,
  "customer_id" text,
  "guest_cart_hash" text,
  "guest_cart_id_ciphertext" text,
  "cart_revision" bigint NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "form_ciphertext" text NOT NULL,
  "items" jsonb NOT NULL,
  "estimated_total_bdt" bigint,
  "delivery_zone" text,
  "destination" jsonb,
  "outcome" text DEFAULT 'new' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "callback_at" timestamp with time zone,
  "last_customer_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checkout_draft_owner_check" CHECK (("customer_id" is not null and "guest_cart_hash" is null and "guest_cart_id_ciphertext" is null) or ("customer_id" is null and "guest_cart_hash" ~ '^[0-9a-f]{64}$' and "guest_cart_id_ciphertext" is not null)),
  CONSTRAINT "checkout_draft_version_check" CHECK ("version" > 0 and "cart_revision" between 0 and 9007199254740991),
  CONSTRAINT "checkout_draft_outcome_check" CHECK ("outcome" in ('new','no_answer','interested','call_back','declined','do_not_contact')),
  CONSTRAINT "checkout_draft_items_check" CHECK (jsonb_typeof("items") = 'array'),
  CONSTRAINT "checkout_draft_attempts_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "source_draft_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "created_by_staff_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkout_draft_customer_id_user_id_fk'
      AND conrelid = 'orders.checkout_draft'::regclass
  ) THEN
    ALTER TABLE "orders"."checkout_draft"
      ADD CONSTRAINT "checkout_draft_customer_id_user_id_fk"
      FOREIGN KEY ("customer_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_draft_owner_uidx" ON "orders"."checkout_draft" USING btree ("owner_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_draft_activity_idx" ON "orders"."checkout_draft" USING btree ("last_customer_activity_at", "id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_header_created_by_staff_id_user_id_fk'
      AND conrelid = 'orders.order_header'::regclass
  ) THEN
    ALTER TABLE "orders"."order_header"
      ADD CONSTRAINT "order_header_created_by_staff_id_user_id_fk"
      FOREIGN KEY ("created_by_staff_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_source_draft_uidx" ON "orders"."order_header" USING btree ("source_draft_id");
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT IF EXISTS "order_staff_source_check";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_staff_source_check" CHECK (("source_draft_id" is null and "created_by_staff_id" is null) or ("source_draft_id" is not null and "created_by_staff_id" is not null));
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT IF EXISTS "order_owner_check";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_owner_check" CHECK (("customer_id" is not null and "guest_cart_hash" is null and "guest_access_token_hash" is null and "guest_access_expires_at" is null) or ("customer_id" is null and "guest_cart_hash" is not null and "guest_cart_hash" ~ '^[0-9a-f]{64}$' and (("source_draft_id" is not null and "guest_access_token_hash" is null and "guest_access_expires_at" is null) or ("source_draft_id" is null and "guest_access_token_hash" is not null and "guest_access_token_hash" ~ '^[0-9a-f]{64}$' and "guest_access_expires_at" is not null and "guest_access_expires_at" = "created_at" + interval '30 days'))));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_created_id_idx" ON "orders"."order_header" USING btree ("created_at" DESC NULLS LAST, "id" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT IF EXISTS "order_address_ciphertext_check";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "address_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ALTER COLUMN "address_snapshot" SET NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;
  function_definition := replace(
    function_definition,
    '"address_ciphertext"',
    '"address_snapshot"'
  );
  EXECUTE function_definition;
END;
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pathao_booking_order_created_idx" ON "delivery"."pathao_booking" USING btree ("order_id", "created_at" DESC NULLS LAST, "id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pathao_booking_submitting_submitted_idx" ON "delivery"."pathao_booking" USING btree ("submitted_at", "id") WHERE "delivery"."pathao_booking"."status" = 'submitting';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pathao_webhook_unmatched_consignment_idx" ON "delivery"."pathao_webhook_inbox" USING btree ("environment", "consignment_id") WHERE "delivery"."pathao_webhook_inbox"."booking_id" is null and "delivery"."pathao_webhook_inbox"."processing_state" = 'unmatched' and "delivery"."pathao_webhook_inbox"."consignment_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_address_name_prefix_idx" ON "orders"."order_header" USING btree (lower("address_snapshot"->>'recipientName') text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_address_phone_prefix_idx" ON "orders"."order_header" USING btree (regexp_replace("address_snapshot"->>'phone', '[^0-9]', '', 'g') text_pattern_ops);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP COLUMN IF EXISTS "address_ciphertext";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT IF EXISTS "order_address_snapshot_check";
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_address_snapshot_check" CHECK (jsonb_typeof("address_snapshot") = 'object');

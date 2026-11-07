CREATE TABLE "orders"."checkout_call_suppression" (
	"phone_hash" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."checkout_draft" (
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
	CONSTRAINT "checkout_draft_owner_check" CHECK (("orders"."checkout_draft"."customer_id" is not null and "orders"."checkout_draft"."guest_cart_hash" is null and "orders"."checkout_draft"."guest_cart_id_ciphertext" is null) or ("orders"."checkout_draft"."customer_id" is null and "orders"."checkout_draft"."guest_cart_hash" ~ '^[0-9a-f]{64}$' and "orders"."checkout_draft"."guest_cart_id_ciphertext" is not null)),
	CONSTRAINT "checkout_draft_version_check" CHECK ("orders"."checkout_draft"."version" > 0 and "orders"."checkout_draft"."cart_revision" between 0 and 9007199254740991),
	CONSTRAINT "checkout_draft_outcome_check" CHECK ("orders"."checkout_draft"."outcome" in ('new','no_answer','interested','call_back','declined','do_not_contact')),
	CONSTRAINT "checkout_draft_items_check" CHECK (jsonb_typeof("orders"."checkout_draft"."items") = 'array'),
	CONSTRAINT "checkout_draft_attempts_check" CHECK ("orders"."checkout_draft"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_owner_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "source_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "created_by_staff_id" text;--> statement-breakpoint
ALTER TABLE "orders"."checkout_draft" ADD CONSTRAINT "checkout_draft_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_draft_owner_uidx" ON "orders"."checkout_draft" USING btree ("owner_hash");--> statement-breakpoint
CREATE INDEX "checkout_draft_activity_idx" ON "orders"."checkout_draft" USING btree ("last_customer_activity_at","id");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_header_created_by_staff_id_user_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_source_draft_uidx" ON "orders"."order_header" USING btree ("source_draft_id");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_staff_source_check" CHECK (("orders"."order_header"."source_draft_id" is null and "orders"."order_header"."created_by_staff_id" is null) or ("orders"."order_header"."source_draft_id" is not null and "orders"."order_header"."created_by_staff_id" is not null));--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_owner_check" CHECK (("orders"."order_header"."customer_id" is not null and "orders"."order_header"."guest_cart_hash" is null and "orders"."order_header"."guest_access_token_hash" is null and "orders"."order_header"."guest_access_expires_at" is null) or ("orders"."order_header"."customer_id" is null and "orders"."order_header"."guest_cart_hash" is not null and "orders"."order_header"."guest_cart_hash" ~ '^[0-9a-f]{64}$' and (("orders"."order_header"."source_draft_id" is not null and "orders"."order_header"."guest_access_token_hash" is null and "orders"."order_header"."guest_access_expires_at" is null) or ("orders"."order_header"."source_draft_id" is null and "orders"."order_header"."guest_access_token_hash" is not null and "orders"."order_header"."guest_access_token_hash" ~ '^[0-9a-f]{64}$' and "orders"."order_header"."guest_access_expires_at" is not null and "orders"."order_header"."guest_access_expires_at" = "orders"."order_header"."created_at" + interval '30 days'))));

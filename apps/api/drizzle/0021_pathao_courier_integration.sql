CREATE TABLE "delivery"."pathao_api_token" (
	"environment" text PRIMARY KEY NOT NULL,
	"access_token_ciphertext" text,
	"refresh_token_ciphertext" text,
	"access_expires_at" timestamp with time zone,
	"refresh_lease_owner" uuid,
	"refresh_lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pathao_api_token_environment_check" CHECK ("delivery"."pathao_api_token"."environment" in ('sandbox', 'live')),
	CONSTRAINT "pathao_api_token_pair_check" CHECK (("delivery"."pathao_api_token"."access_token_ciphertext" is null and "delivery"."pathao_api_token"."refresh_token_ciphertext" is null and "delivery"."pathao_api_token"."access_expires_at" is null) or ("delivery"."pathao_api_token"."access_token_ciphertext" is not null and "delivery"."pathao_api_token"."refresh_token_ciphertext" is not null and "delivery"."pathao_api_token"."access_expires_at" is not null)),
	CONSTRAINT "pathao_api_token_lease_pair_check" CHECK (("delivery"."pathao_api_token"."refresh_lease_owner" is null and "delivery"."pathao_api_token"."refresh_lease_expires_at" is null) or ("delivery"."pathao_api_token"."refresh_lease_owner" is not null and "delivery"."pathao_api_token"."refresh_lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "delivery"."pathao_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"store_id" integer NOT NULL,
	"delivery_type" integer NOT NULL,
	"parcel_quantity" integer NOT NULL,
	"parcel_weight_kg" numeric NOT NULL,
	"merchant_order_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"consignment_id" text,
	"provider_order_status" text,
	"delivery_fee_bdt" numeric,
	"tracking_progress" text DEFAULT 'booked' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pathao_booking_environment_check" CHECK ("delivery"."pathao_booking"."environment" in ('sandbox', 'live')),
	CONSTRAINT "pathao_booking_delivery_type_check" CHECK ("delivery"."pathao_booking"."delivery_type" in (12, 48)),
	CONSTRAINT "pathao_booking_parcel_quantity_check" CHECK ("delivery"."pathao_booking"."parcel_quantity" > 0),
	CONSTRAINT "pathao_booking_weight_check" CHECK ("delivery"."pathao_booking"."parcel_weight_kg" between 0.5 and 10),
	CONSTRAINT "pathao_booking_reference_check" CHECK ("delivery"."pathao_booking"."merchant_order_id" ~ '^AA-[0-9A-F]{12}$'),
	CONSTRAINT "pathao_booking_fingerprint_check" CHECK ("delivery"."pathao_booking"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pathao_booking_status_check" CHECK ("delivery"."pathao_booking"."status" in ('submitting', 'booked', 'outcome_unknown', 'reconciliation_required')),
	CONSTRAINT "pathao_booking_result_check" CHECK (("delivery"."pathao_booking"."status" = 'booked' and "delivery"."pathao_booking"."consignment_id" is not null) or ("delivery"."pathao_booking"."status" <> 'booked' and "delivery"."pathao_booking"."consignment_id" is null)),
	CONSTRAINT "pathao_booking_delivery_fee_check" CHECK ("delivery"."pathao_booking"."delivery_fee_bdt" is null or "delivery"."pathao_booking"."delivery_fee_bdt" >= 0),
	CONSTRAINT "pathao_booking_tracking_progress_check" CHECK ("delivery"."pathao_booking"."tracking_progress" in ('booked', 'pickup', 'in_transit', 'out_for_delivery', 'delivered', 'partial_delivery', 'delivery_failed', 'returning', 'returned', 'on_hold', 'reconciliation_required'))
);
--> statement-breakpoint
CREATE TABLE "delivery"."pathao_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"event_name" text NOT NULL,
	"consignment_id" text,
	"merchant_order_id" text,
	"store_id" integer,
	"booking_id" uuid,
	"event_fingerprint" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"provider_timestamp" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_state" text DEFAULT 'pending' NOT NULL,
	"provider_order_status" text,
	"provider_collected_amount_bdt" numeric,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "pathao_webhook_environment_check" CHECK ("delivery"."pathao_webhook_inbox"."environment" in ('sandbox', 'live')),
	CONSTRAINT "pathao_webhook_event_name_check" CHECK (length("delivery"."pathao_webhook_inbox"."event_name") between 1 and 80),
	CONSTRAINT "pathao_webhook_fingerprint_check" CHECK ("delivery"."pathao_webhook_inbox"."event_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pathao_webhook_payload_object_check" CHECK (jsonb_typeof("delivery"."pathao_webhook_inbox"."normalized_payload") = 'object'),
	CONSTRAINT "pathao_webhook_processing_state_check" CHECK ("delivery"."pathao_webhook_inbox"."processing_state" in ('pending', 'retry', 'processing', 'verified', 'reconciliation_required', 'unmatched', 'ignored')),
	CONSTRAINT "pathao_webhook_amount_check" CHECK ("delivery"."pathao_webhook_inbox"."provider_collected_amount_bdt" is null or "delivery"."pathao_webhook_inbox"."provider_collected_amount_bdt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery"."pathao_booking" ADD CONSTRAINT "pathao_booking_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."pathao_booking" ADD CONSTRAINT "pathao_booking_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."pathao_webhook_inbox" ADD CONSTRAINT "pathao_webhook_inbox_booking_id_pathao_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "delivery"."pathao_booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_booking_order_uidx" ON "delivery"."pathao_booking" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_booking_command_uidx" ON "delivery"."pathao_booking" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_booking_merchant_reference_uidx" ON "delivery"."pathao_booking" USING btree ("environment","merchant_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_booking_consignment_uidx" ON "delivery"."pathao_booking" USING btree ("environment","consignment_id");--> statement-breakpoint
CREATE INDEX "pathao_booking_created_idx" ON "delivery"."pathao_booking" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "pathao_webhook_fingerprint_uidx" ON "delivery"."pathao_webhook_inbox" USING btree ("environment","event_fingerprint");--> statement-breakpoint
CREATE INDEX "pathao_webhook_pending_idx" ON "delivery"."pathao_webhook_inbox" USING btree ("next_attempt_at","received_at","id") WHERE "delivery"."pathao_webhook_inbox"."processing_state" in ('pending', 'retry');--> statement-breakpoint
CREATE INDEX "pathao_webhook_booking_received_idx" ON "delivery"."pathao_webhook_inbox" USING btree ("booking_id","received_at");
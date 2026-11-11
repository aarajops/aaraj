CREATE TABLE "orders"."courier_remittance_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"merchant_account_ref" text NOT NULL,
	"provider_remittance_ref" text NOT NULL,
	"statement_sha256" text NOT NULL,
	"statement_total_bdt" bigint NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"reconciliation_command_id" uuid,
	"reconciliation_fingerprint" text,
	"reconciliation_reason" text,
	"created_by" text NOT NULL,
	"reconciled_by" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_remittance_provider_check" CHECK ("orders"."courier_remittance_batch"."provider" = 'pathao'),
	CONSTRAINT "courier_remittance_account_ref_check" CHECK ("orders"."courier_remittance_batch"."merchant_account_ref" = btrim("orders"."courier_remittance_batch"."merchant_account_ref") and length("orders"."courier_remittance_batch"."merchant_account_ref") between 1 and 120),
	CONSTRAINT "courier_remittance_provider_ref_check" CHECK ("orders"."courier_remittance_batch"."provider_remittance_ref" = btrim("orders"."courier_remittance_batch"."provider_remittance_ref") and length("orders"."courier_remittance_batch"."provider_remittance_ref") between 1 and 160),
	CONSTRAINT "courier_remittance_hash_check" CHECK ("orders"."courier_remittance_batch"."statement_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "courier_remittance_amount_check" CHECK ("orders"."courier_remittance_batch"."statement_total_bdt" between 0 and 9007199254740991),
	CONSTRAINT "courier_remittance_status_check" CHECK ("orders"."courier_remittance_batch"."status" in ('open', 'reconciled')),
	CONSTRAINT "courier_remittance_request_fingerprint_check" CHECK ("orders"."courier_remittance_batch"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "courier_remittance_reconciliation_pair_check" CHECK (("orders"."courier_remittance_batch"."reconciliation_command_id" is null and "orders"."courier_remittance_batch"."reconciliation_fingerprint" is null and "orders"."courier_remittance_batch"."reconciliation_reason" is null and "orders"."courier_remittance_batch"."reconciled_by" is null and "orders"."courier_remittance_batch"."reconciled_at" is null) or ("orders"."courier_remittance_batch"."reconciliation_command_id" is not null and "orders"."courier_remittance_batch"."reconciliation_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."courier_remittance_batch"."reconciliation_reason" is not null and "orders"."courier_remittance_batch"."reconciled_by" is not null and "orders"."courier_remittance_batch"."reconciled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "orders"."courier_remittance_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"consignment_ref" text NOT NULL,
	"order_id" uuid,
	"expected_collected_amount_bdt" bigint,
	"collected_amount_bdt" bigint NOT NULL,
	"fee_amount_bdt" bigint NOT NULL,
	"net_amount_bdt" bigint NOT NULL,
	CONSTRAINT "courier_remittance_line_number_check" CHECK ("orders"."courier_remittance_line"."line_number" > 0),
	CONSTRAINT "courier_remittance_line_consignment_check" CHECK ("orders"."courier_remittance_line"."consignment_ref" = btrim("orders"."courier_remittance_line"."consignment_ref") and length("orders"."courier_remittance_line"."consignment_ref") between 1 and 120),
	CONSTRAINT "courier_remittance_line_amount_check" CHECK ("orders"."courier_remittance_line"."collected_amount_bdt" between 0 and 9007199254740991 and "orders"."courier_remittance_line"."fee_amount_bdt" between 0 and 9007199254740991 and "orders"."courier_remittance_line"."net_amount_bdt" between 0 and 9007199254740991 and "orders"."courier_remittance_line"."net_amount_bdt" = "orders"."courier_remittance_line"."collected_amount_bdt" - "orders"."courier_remittance_line"."fee_amount_bdt"),
	CONSTRAINT "courier_remittance_line_expected_check" CHECK ("orders"."courier_remittance_line"."expected_collected_amount_bdt" is null or "orders"."courier_remittance_line"."expected_collected_amount_bdt" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "orders"."order_delivery_line" (
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity_ordered" integer NOT NULL,
	"quantity_delivered" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_line_quantity_check" CHECK ("orders"."order_delivery_line"."quantity_ordered" between 1 and 10 and "orders"."order_delivery_line"."quantity_delivered" between 0 and "orders"."order_delivery_line"."quantity_ordered")
);
--> statement-breakpoint
CREATE TABLE "orders"."order_return_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"decision_reason" text,
	"maximum_refund_amount_bdt" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"decision_command_id" uuid,
	"decision_fingerprint" text,
	"received_command_id" uuid,
	"received_fingerprint" text,
	"inspection_command_id" uuid,
	"inspection_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_return_case_origin_check" CHECK ("orders"."order_return_case"."origin" in ('customer_return', 'courier_rts', 'doorstep_refusal')),
	CONSTRAINT "order_return_case_status_check" CHECK ("orders"."order_return_case"."status" in ('requested', 'authorized', 'rejected', 'received', 'inspected', 'refund_pending', 'refunded', 'closed')),
	CONSTRAINT "order_return_case_reason_check" CHECK ("orders"."order_return_case"."reason" = btrim("orders"."order_return_case"."reason") and length("orders"."order_return_case"."reason") between 3 and 500),
	CONSTRAINT "order_return_case_refund_check" CHECK ("orders"."order_return_case"."maximum_refund_amount_bdt" between 0 and 9007199254740991),
	CONSTRAINT "order_return_case_request_fingerprint_check" CHECK ("orders"."order_return_case"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_return_case_decision_pair_check" CHECK (("orders"."order_return_case"."decision_command_id" is null and "orders"."order_return_case"."decision_fingerprint" is null) or ("orders"."order_return_case"."decision_command_id" is not null and "orders"."order_return_case"."decision_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "order_return_case_received_pair_check" CHECK (("orders"."order_return_case"."received_command_id" is null and "orders"."order_return_case"."received_fingerprint" is null) or ("orders"."order_return_case"."received_command_id" is not null and "orders"."order_return_case"."received_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "order_return_case_inspection_pair_check" CHECK (("orders"."order_return_case"."inspection_command_id" is null and "orders"."order_return_case"."inspection_fingerprint" is null) or ("orders"."order_return_case"."inspection_command_id" is not null and "orders"."order_return_case"."inspection_fingerprint" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "orders"."order_return_case_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_case_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"requested_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price_bdt" bigint NOT NULL,
	CONSTRAINT "order_return_case_line_quantity_check" CHECK ("orders"."order_return_case_line"."requested_quantity" between 1 and 10 and "orders"."order_return_case_line"."received_quantity" between 0 and "orders"."order_return_case_line"."requested_quantity"),
	CONSTRAINT "order_return_case_line_money_check" CHECK ("orders"."order_return_case_line"."unit_price_bdt" between 0 and 9007199254740991),
	CONSTRAINT "order_return_case_line_product_snapshot_check" CHECK (jsonb_typeof("orders"."order_return_case_line"."product_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "orders"."order_return_inspection" (
	"return_line_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"quantity" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"inspected_by" text NOT NULL,
	"reason" text NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_return_inspection_pk" PRIMARY KEY("return_line_id","grade"),
	CONSTRAINT "order_return_inspection_grade_check" CHECK ("orders"."order_return_inspection"."grade" in ('sellable', 'repairable', 'damaged', 'fraud_review')),
	CONSTRAINT "order_return_inspection_quantity_check" CHECK ("orders"."order_return_inspection"."quantity" > 0),
	CONSTRAINT "order_return_inspection_reason_check" CHECK ("orders"."order_return_inspection"."reason" = btrim("orders"."order_return_inspection"."reason") and length("orders"."order_return_inspection"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "orders"."order_return_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_case_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"amount_bdt" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_return_refund_amount_check" CHECK ("orders"."order_return_refund"."amount_bdt" between 0 and 9007199254740991),
	CONSTRAINT "order_return_refund_method_check" CHECK ("orders"."order_return_refund"."method" in ('bank_transfer', 'mobile_money', 'cash')),
	CONSTRAINT "order_return_refund_reference_check" CHECK (("orders"."order_return_refund"."amount_bdt" = 0 and "orders"."order_return_refund"."reference" is null) or ("orders"."order_return_refund"."amount_bdt" > 0 and "orders"."order_return_refund"."reference" is not null and "orders"."order_return_refund"."reference" = btrim("orders"."order_return_refund"."reference") and length("orders"."order_return_refund"."reference") between 1 and 160)),
	CONSTRAINT "order_return_refund_reason_check" CHECK ("orders"."order_return_refund"."reason" = btrim("orders"."order_return_refund"."reason") and length("orders"."order_return_refund"."reason") between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_batch" ADD CONSTRAINT "courier_remittance_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_batch" ADD CONSTRAINT "courier_remittance_batch_reconciled_by_user_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD CONSTRAINT "courier_remittance_line_batch_id_courier_remittance_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "orders"."courier_remittance_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD CONSTRAINT "courier_remittance_line_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_delivery_line" ADD CONSTRAINT "order_delivery_line_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_delivery_line" ADD CONSTRAINT "order_delivery_line_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "orders"."order_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_case" ADD CONSTRAINT "order_return_case_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_case" ADD CONSTRAINT "order_return_case_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_case_line" ADD CONSTRAINT "order_return_case_line_return_case_id_order_return_case_id_fk" FOREIGN KEY ("return_case_id") REFERENCES "orders"."order_return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_case_line" ADD CONSTRAINT "order_return_case_line_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "orders"."order_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_inspection" ADD CONSTRAINT "order_return_inspection_return_line_id_order_return_case_line_id_fk" FOREIGN KEY ("return_line_id") REFERENCES "orders"."order_return_case_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_inspection" ADD CONSTRAINT "order_return_inspection_inspected_by_user_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_refund" ADD CONSTRAINT "order_return_refund_return_case_id_order_return_case_id_fk" FOREIGN KEY ("return_case_id") REFERENCES "orders"."order_return_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_return_refund" ADD CONSTRAINT "order_return_refund_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_batch_reference_uidx" ON "orders"."courier_remittance_batch" USING btree ("provider","merchant_account_ref","provider_remittance_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_batch_hash_uidx" ON "orders"."courier_remittance_batch" USING btree ("provider","merchant_account_ref","statement_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_batch_command_uidx" ON "orders"."courier_remittance_batch" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_batch_reconcile_command_uidx" ON "orders"."courier_remittance_batch" USING btree ("reconciliation_command_id");--> statement-breakpoint
CREATE INDEX "courier_remittance_batch_created_idx" ON "orders"."courier_remittance_batch" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_line_number_uidx" ON "orders"."courier_remittance_line" USING btree ("batch_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_line_consignment_uidx" ON "orders"."courier_remittance_line" USING btree ("batch_id","consignment_ref");--> statement-breakpoint
CREATE INDEX "courier_remittance_line_order_idx" ON "orders"."courier_remittance_line" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_delivery_line_line_uidx" ON "orders"."order_delivery_line" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "order_delivery_line_order_idx" ON "orders"."order_delivery_line" USING btree ("order_id","order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_case_command_uidx" ON "orders"."order_return_case" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_case_decision_command_uidx" ON "orders"."order_return_case" USING btree ("decision_command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_case_received_command_uidx" ON "orders"."order_return_case" USING btree ("received_command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_case_inspection_command_uidx" ON "orders"."order_return_case" USING btree ("inspection_command_id");--> statement-breakpoint
CREATE INDEX "order_return_case_order_created_idx" ON "orders"."order_return_case" USING btree ("order_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_case_line_case_order_line_uidx" ON "orders"."order_return_case_line" USING btree ("return_case_id","order_line_id");--> statement-breakpoint
CREATE INDEX "order_return_case_line_order_line_idx" ON "orders"."order_return_case_line" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_inspection_command_uidx" ON "orders"."order_return_inspection" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_refund_case_uidx" ON "orders"."order_return_refund" USING btree ("return_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_refund_command_uidx" ON "orders"."order_return_refund" USING btree ("command_id");
--> statement-breakpoint
INSERT INTO "orders"."order_delivery_line"
  ("order_id", "order_line_id", "quantity_ordered", "quantity_delivered", "updated_at")
SELECT "order"."id", "line"."id", "line"."quantity", "line"."quantity", clock_timestamp()
  FROM "orders"."order_header" AS "order"
  JOIN "orders"."order_line" AS "line" ON "line"."order_id" = "order"."id"
 WHERE "order"."fulfillment_status" = 'delivered'
ON CONFLICT ("order_line_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "orders"."order_return_case" ADD COLUMN "receipt_reason" text;--> statement-breakpoint
DO $$
DECLARE
  function_definition text;
  old_states text := 'OLD."fulfillment_status" IN (''dispatched'', ''partially_delivered'', ''delivery_failed'')';
  new_states text := 'OLD."fulfillment_status" IN (''dispatched'', ''partially_delivered'', ''delivery_failed'', ''delivered'')';
  old_transition text := E'OR (OLD."fulfillment_status" = ''delivery_failed''\n           AND NEW."fulfillment_status" NOT IN (''delivery_failed'', ''partially_delivered'', ''delivered'', ''returned''))';
  new_transition text := E'OR (OLD."fulfillment_status" = ''delivery_failed''\n           AND NEW."fulfillment_status" NOT IN (''delivery_failed'', ''partially_delivered'', ''delivered'', ''returned''))\n       OR (OLD."fulfillment_status" = ''delivered''\n           AND NEW."fulfillment_status" NOT IN (''returned''))';
BEGIN
  SELECT pg_get_functiondef('orders.protect_order_header_update()'::regprocedure)
    INTO function_definition;
  IF position(old_states IN function_definition) = 0
     OR position(old_transition IN function_definition) = 0 THEN
    RAISE EXCEPTION 'The Order return completion transition could not be migrated';
  END IF;
  function_definition := replace(function_definition, old_states, new_states);
  function_definition := replace(function_definition, old_transition, new_transition);
  EXECUTE function_definition;
END;
$$;
--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolution_status" text DEFAULT 'matched' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolution_command_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolution_fingerprint" text;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
UPDATE "orders"."courier_remittance_line"
   SET "resolution_status" = 'pending'
 WHERE "order_id" IS NULL;--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD CONSTRAINT "courier_remittance_line_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_remittance_line_resolution_command_uidx" ON "orders"."courier_remittance_line" USING btree ("resolution_command_id");--> statement-breakpoint
ALTER TABLE "orders"."courier_remittance_line" ADD CONSTRAINT "courier_remittance_line_resolution_check" CHECK (("orders"."courier_remittance_line"."resolution_status" = 'matched' and "orders"."courier_remittance_line"."resolution_reason" is null and "orders"."courier_remittance_line"."resolution_command_id" is null and "orders"."courier_remittance_line"."resolution_fingerprint" is null and "orders"."courier_remittance_line"."resolved_by" is null and "orders"."courier_remittance_line"."resolved_at" is null) or ("orders"."courier_remittance_line"."resolution_status" = 'pending' and "orders"."courier_remittance_line"."order_id" is null and "orders"."courier_remittance_line"."resolution_reason" is null and "orders"."courier_remittance_line"."resolution_command_id" is null and "orders"."courier_remittance_line"."resolution_fingerprint" is null and "orders"."courier_remittance_line"."resolved_by" is null and "orders"."courier_remittance_line"."resolved_at" is null) or ("orders"."courier_remittance_line"."resolution_status" = 'external' and "orders"."courier_remittance_line"."order_id" is null and "orders"."courier_remittance_line"."resolution_reason" is not null and "orders"."courier_remittance_line"."resolution_command_id" is not null and "orders"."courier_remittance_line"."resolution_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."courier_remittance_line"."resolved_by" is not null and "orders"."courier_remittance_line"."resolved_at" is not null));
--> statement-breakpoint
CREATE TABLE "orders"."order_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"sequence_year" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_receipt_number_check" CHECK ("orders"."order_receipt"."receipt_number" ~ '^AAR-[0-9]{4}-[0-9]{6}$'),
	CONSTRAINT "order_receipt_year_check" CHECK ("orders"."order_receipt"."sequence_year" between 1 and 9999),
	CONSTRAINT "order_receipt_sequence_check" CHECK ("orders"."order_receipt"."sequence_number" between 1 and 999999),
	CONSTRAINT "order_receipt_snapshot_check" CHECK (jsonb_typeof("orders"."order_receipt"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "orders"."order_receipt_counter" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "order_receipt_counter_year_check" CHECK ("orders"."order_receipt_counter"."year" between 1 and 9999),
	CONSTRAINT "order_receipt_counter_number_check" CHECK ("orders"."order_receipt_counter"."last_number" between 1 and 999999)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_receipt" ADD CONSTRAINT "order_receipt_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_receipt" ADD CONSTRAINT "order_receipt_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_receipt_order_uidx" ON "orders"."order_receipt" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_receipt_number_uidx" ON "orders"."order_receipt" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_receipt_sequence_uidx" ON "orders"."order_receipt" USING btree ("sequence_year","sequence_number");--> statement-breakpoint
CREATE INDEX "order_receipt_issued_idx" ON "orders"."order_receipt" USING btree ("issued_at","id");
--> statement-breakpoint
CREATE FUNCTION "orders"."protect_order_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'An issued delivery receipt is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "orders"."order_header" AS saved_order
     WHERE saved_order."id" = NEW."order_id"
       AND saved_order."status" = 'confirmed'
       AND saved_order."fulfillment_status" IN ('delivered', 'returned')
  ) THEN
    RAISE EXCEPTION 'A delivery receipt requires a verified fully delivered Order';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_receipt_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "orders"."order_receipt"
FOR EACH ROW EXECUTE FUNCTION "orders"."protect_order_receipt"();
--> statement-breakpoint
CREATE TABLE "orders"."courier_settlement_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"bank_reference" text NOT NULL,
	"bank_amount_bdt" bigint NOT NULL,
	"reason" text NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_settlement_confirmation_fingerprint_check" CHECK ("orders"."courier_settlement_confirmation"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "courier_settlement_confirmation_amount_check" CHECK ("orders"."courier_settlement_confirmation"."bank_amount_bdt" between 0 and 9007199254740991),
	CONSTRAINT "courier_settlement_confirmation_reference_check" CHECK ("orders"."courier_settlement_confirmation"."bank_reference" = btrim("orders"."courier_settlement_confirmation"."bank_reference") and length("orders"."courier_settlement_confirmation"."bank_reference") between 1 and 160),
	CONSTRAINT "courier_settlement_confirmation_reason_check" CHECK ("orders"."courier_settlement_confirmation"."reason" = btrim("orders"."courier_settlement_confirmation"."reason") and length("orders"."courier_settlement_confirmation"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "orders"."courier_settlement_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"confirmation_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"posted_by" text NOT NULL,
	"posted_at" timestamp with time zone,
	"bank_reference" text NOT NULL,
	"bank_amount_bdt" bigint NOT NULL,
	"total_collected_bdt" bigint NOT NULL,
	"total_fees_bdt" bigint NOT NULL,
	"total_net_bdt" bigint NOT NULL,
	"variance_bdt" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_settlement_journal_status_check" CHECK ("orders"."courier_settlement_journal"."status" in ('draft', 'posted')),
	CONSTRAINT "courier_settlement_journal_amount_check" CHECK ("orders"."courier_settlement_journal"."bank_amount_bdt" between 0 and 9007199254740991 and "orders"."courier_settlement_journal"."total_collected_bdt" between 0 and 9007199254740991 and "orders"."courier_settlement_journal"."total_fees_bdt" between 0 and 9007199254740991 and "orders"."courier_settlement_journal"."total_net_bdt" between 0 and 9007199254740991 and "orders"."courier_settlement_journal"."variance_bdt" between -9007199254740991 and 9007199254740991 and "orders"."courier_settlement_journal"."total_net_bdt" = "orders"."courier_settlement_journal"."total_collected_bdt" - "orders"."courier_settlement_journal"."total_fees_bdt"),
	CONSTRAINT "courier_settlement_journal_reference_check" CHECK ("orders"."courier_settlement_journal"."bank_reference" = btrim("orders"."courier_settlement_journal"."bank_reference") and length("orders"."courier_settlement_journal"."bank_reference") between 1 and 160),
	CONSTRAINT "courier_settlement_journal_posted_pair_check" CHECK (("orders"."courier_settlement_journal"."status" = 'draft' and "orders"."courier_settlement_journal"."posted_at" is null) or ("orders"."courier_settlement_journal"."status" = 'posted' and "orders"."courier_settlement_journal"."posted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "orders"."courier_settlement_journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_key" text NOT NULL,
	"debit_bdt" bigint DEFAULT 0 NOT NULL,
	"credit_bdt" bigint DEFAULT 0 NOT NULL,
	"memo" text NOT NULL,
	"source_line_id" uuid,
	CONSTRAINT "courier_settlement_journal_entry_line_check" CHECK ("orders"."courier_settlement_journal_entry"."line_number" > 0),
	CONSTRAINT "courier_settlement_journal_entry_account_check" CHECK ("orders"."courier_settlement_journal_entry"."account_key" in ('bank_cash', 'courier_fee_expense', 'cod_settlement_clearing', 'settlement_variance_suspense')),
	CONSTRAINT "courier_settlement_journal_entry_amount_check" CHECK ("orders"."courier_settlement_journal_entry"."debit_bdt" between 0 and 9007199254740991 and "orders"."courier_settlement_journal_entry"."credit_bdt" between 0 and 9007199254740991 and (("orders"."courier_settlement_journal_entry"."debit_bdt" > 0 and "orders"."courier_settlement_journal_entry"."credit_bdt" = 0) or ("orders"."courier_settlement_journal_entry"."credit_bdt" > 0 and "orders"."courier_settlement_journal_entry"."debit_bdt" = 0))),
	CONSTRAINT "courier_settlement_journal_entry_memo_check" CHECK ("orders"."courier_settlement_journal_entry"."memo" = btrim("orders"."courier_settlement_journal_entry"."memo") and length("orders"."courier_settlement_journal_entry"."memo") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "orders"."order_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"provider_message_sid" text,
	"provider_status" text,
	"last_error_code" text,
	"resolution_command_id" uuid,
	"resolution_fingerprint" text,
	"resolution_reason" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_notification_event_check" CHECK ("orders"."order_notification_outbox"."event_key" in ('order_received', 'order_confirmed', 'order_cancelled', 'order_dispatched', 'order_partially_delivered', 'order_delivered', 'order_delivery_issue', 'order_returned')),
	CONSTRAINT "order_notification_channel_check" CHECK ("orders"."order_notification_outbox"."channel" = 'sms'),
	CONSTRAINT "order_notification_status_check" CHECK ("orders"."order_notification_outbox"."status" in ('pending', 'sending', 'unknown', 'accepted', 'delivered', 'failed', 'suppressed')),
	CONSTRAINT "order_notification_attempt_check" CHECK ("orders"."order_notification_outbox"."attempt_count" >= 0),
	CONSTRAINT "order_notification_provider_sid_check" CHECK ("orders"."order_notification_outbox"."provider_message_sid" is null or "orders"."order_notification_outbox"."provider_message_sid" ~ '^SM[0-9a-fA-F]{32}$'),
	CONSTRAINT "order_notification_error_check" CHECK ("orders"."order_notification_outbox"."last_error_code" is null or "orders"."order_notification_outbox"."last_error_code" ~ '^[A-Z0-9_]{1,80}$'),
	CONSTRAINT "order_notification_resolution_pair_check" CHECK (("orders"."order_notification_outbox"."resolution_command_id" is null and "orders"."order_notification_outbox"."resolution_fingerprint" is null and "orders"."order_notification_outbox"."resolution_reason" is null and "orders"."order_notification_outbox"."resolved_by" is null and "orders"."order_notification_outbox"."resolved_at" is null) or ("orders"."order_notification_outbox"."resolution_command_id" is not null and "orders"."order_notification_outbox"."resolution_fingerprint" ~ '^[0-9a-f]{64}$' and "orders"."order_notification_outbox"."resolution_reason" is not null and "orders"."order_notification_outbox"."resolved_by" is not null and "orders"."order_notification_outbox"."resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN "sms_updates_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_confirmation" ADD CONSTRAINT "courier_settlement_confirmation_batch_id_courier_remittance_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "orders"."courier_remittance_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_confirmation" ADD CONSTRAINT "courier_settlement_confirmation_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_journal" ADD CONSTRAINT "courier_settlement_journal_batch_id_courier_remittance_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "orders"."courier_remittance_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_journal" ADD CONSTRAINT "courier_settlement_journal_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_journal_entry" ADD CONSTRAINT "courier_settlement_journal_entry_journal_id_courier_settlement_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "orders"."courier_settlement_journal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_journal_entry" ADD CONSTRAINT "courier_settlement_journal_entry_source_line_id_courier_remittance_line_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "orders"."courier_remittance_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_notification_outbox" ADD CONSTRAINT "order_notification_outbox_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_notification_outbox" ADD CONSTRAINT "order_notification_outbox_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_confirmation_batch_uidx" ON "orders"."courier_settlement_confirmation" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_confirmation_command_uidx" ON "orders"."courier_settlement_confirmation" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_journal_batch_uidx" ON "orders"."courier_settlement_journal" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_journal_confirmation_uidx" ON "orders"."courier_settlement_journal" USING btree ("confirmation_id");--> statement-breakpoint
CREATE INDEX "courier_settlement_journal_posted_idx" ON "orders"."courier_settlement_journal" USING btree ("posted_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_journal_entry_number_uidx" ON "orders"."courier_settlement_journal_entry" USING btree ("journal_id","line_number");--> statement-breakpoint
CREATE INDEX "courier_settlement_journal_entry_account_idx" ON "orders"."courier_settlement_journal_entry" USING btree ("account_key","journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_notification_event_uidx" ON "orders"."order_notification_outbox" USING btree ("order_id","event_key","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "order_notification_provider_sid_uidx" ON "orders"."order_notification_outbox" USING btree ("provider_message_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "order_notification_resolution_command_uidx" ON "orders"."order_notification_outbox" USING btree ("resolution_command_id");--> statement-breakpoint
CREATE INDEX "order_notification_queue_idx" ON "orders"."order_notification_outbox" USING btree ("available_at","created_at") WHERE "orders"."order_notification_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "order_notification_exception_idx" ON "orders"."order_notification_outbox" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "orders"."order_notification_outbox"."status" in ('unknown', 'failed');
--> statement-breakpoint
ALTER TABLE "orders"."courier_settlement_journal"
  ADD CONSTRAINT "courier_settlement_journal_confirmation_id_fk"
  FOREIGN KEY ("confirmation_id") REFERENCES "orders"."courier_settlement_confirmation"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION "orders"."enqueue_order_notification"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
  IF NEW."sms_updates_consent" IS NOT TRUE THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    event_name := CASE WHEN NEW."status" = 'confirmed' THEN 'order_confirmed' ELSE 'order_received' END;
    INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
    VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    event_name := CASE NEW."status"
      WHEN 'confirmed' THEN 'order_confirmed'
      WHEN 'cancelled' THEN 'order_cancelled'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
      VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    END IF;
  END IF;

  IF NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status" THEN
    event_name := CASE NEW."fulfillment_status"
      WHEN 'dispatched' THEN 'order_dispatched'
      WHEN 'partially_delivered' THEN 'order_partially_delivered'
      WHEN 'delivered' THEN 'order_delivered'
      WHEN 'delivery_failed' THEN 'order_delivery_issue'
      WHEN 'returned' THEN 'order_returned'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
      VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "order_notification_transition_outbox"
AFTER INSERT OR UPDATE OF "status", "fulfillment_status" ON "orders"."order_header"
FOR EACH ROW EXECUTE FUNCTION "orders"."enqueue_order_notification"();
--> statement-breakpoint
CREATE FUNCTION "orders"."protect_courier_settlement_journal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit_total numeric;
DECLARE credit_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'posted' THEN RAISE EXCEPTION 'Posted settlement journals are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'draft' OR NEW."status" <> 'posted' OR NEW."posted_at" IS NULL THEN
      RAISE EXCEPTION 'A settlement journal may only transition once from draft to posted';
    END IF;
    SELECT COALESCE(sum("debit_bdt"), 0), COALESCE(sum("credit_bdt"), 0)
      INTO debit_total, credit_total
      FROM "orders"."courier_settlement_journal_entry"
     WHERE "journal_id" = OLD."id";
    IF debit_total <= 0 OR debit_total <> credit_total THEN
      RAISE EXCEPTION 'A settlement journal must have equal non-zero debits and credits';
    END IF;
    IF debit_total <> NEW."bank_amount_bdt" + NEW."total_fees_bdt" + GREATEST(-NEW."variance_bdt", 0)
       OR credit_total <> NEW."total_collected_bdt" + GREATEST(NEW."variance_bdt", 0) THEN
      RAISE EXCEPTION 'Settlement journal entries do not agree with the settlement summary';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" <> 'draft' OR NEW."posted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A settlement journal must be inserted as a draft';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "courier_settlement_journal_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "orders"."courier_settlement_journal"
FOR EACH ROW EXECUTE FUNCTION "orders"."protect_courier_settlement_journal"();
--> statement-breakpoint
CREATE FUNCTION "orders"."protect_courier_settlement_journal_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved_status text;
BEGIN
  SELECT "status" INTO saved_status FROM "orders"."courier_settlement_journal"
   WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."journal_id" ELSE NEW."journal_id" END
   FOR UPDATE;
  IF saved_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Entries of a posted settlement journal are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "courier_settlement_journal_entry_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "orders"."courier_settlement_journal_entry"
FOR EACH ROW EXECUTE FUNCTION "orders"."protect_courier_settlement_journal_entry"();
--> statement-breakpoint
CREATE UNIQUE INDEX "courier_settlement_confirmation_bank_reference_uidx" ON "orders"."courier_settlement_confirmation" USING btree ("bank_reference");
--> statement-breakpoint
CREATE TABLE "orders"."order_notification_consent_revocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders"."order_notification_consent_revocation" ADD CONSTRAINT "order_notification_consent_revocation_order_id_order_header_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."order_header"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_notification_consent_revocation" ADD CONSTRAINT "order_notification_consent_revocation_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_notification_consent_revocation_order_uidx" ON "orders"."order_notification_consent_revocation" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_notification_consent_revocation_time_idx" ON "orders"."order_notification_consent_revocation" USING btree ("revoked_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "orders"."enqueue_order_notification"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
  IF NEW."sms_updates_consent" IS NOT TRUE OR EXISTS (
    SELECT 1 FROM "orders"."order_notification_consent_revocation" AS revocation
     WHERE revocation."order_id" = NEW."id"
  ) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    event_name := CASE WHEN NEW."status" = 'confirmed' THEN 'order_confirmed' ELSE 'order_received' END;
    INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
    VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    event_name := CASE NEW."status"
      WHEN 'confirmed' THEN 'order_confirmed'
      WHEN 'cancelled' THEN 'order_cancelled'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
      VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    END IF;
  END IF;

  IF NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status" THEN
    event_name := CASE NEW."fulfillment_status"
      WHEN 'dispatched' THEN 'order_dispatched'
      WHEN 'partially_delivered' THEN 'order_partially_delivered'
      WHEN 'delivered' THEN 'order_delivered'
      WHEN 'delivery_failed' THEN 'order_delivery_issue'
      WHEN 'returned' THEN 'order_returned'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO "orders"."order_notification_outbox" ("order_id", "event_key")
      VALUES (NEW."id", event_name) ON CONFLICT ("order_id", "event_key", "channel") DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

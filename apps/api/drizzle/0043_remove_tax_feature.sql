ALTER TABLE "quote"."snapshot" DROP CONSTRAINT "snapshot_tax_object_check";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP CONSTRAINT "snapshot_amount_check";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP CONSTRAINT "order_snapshot_object_check";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP CONSTRAINT "snapshot_tax_profile_version_profile_version_fk";
--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "tax_profile_version";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "tax_source_reference";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "tax_source_version";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "tax_rounding_rule";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "tax_profile_snapshot";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "merchandise_tax_snapshot";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "delivery_tax_snapshot";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP COLUMN "total_tax_amount_bdt";--> statement-breakpoint
ALTER TABLE "orders"."order_header" DROP COLUMN "tax_snapshot";--> statement-breakpoint
DROP TABLE "tax"."configuration";--> statement-breakpoint
DROP TABLE "tax"."profile";--> statement-breakpoint
DROP SCHEMA "tax";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "orders"."protect_order_header_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_status text;
  command_reservation_id uuid;
  command_operation text;
BEGIN
  IF ROW(
    NEW."id", NEW."reference", NEW."customer_id", NEW."guest_cart_hash",
    NEW."guest_access_token_hash", NEW."guest_access_expires_at", NEW."quote_id",
    NEW."cart_revision", NEW."reservation_id", NEW."address_ciphertext",
    NEW."payment_method", NEW."collection_status", NEW."merchandise_gross_bdt",
    NEW."delivery_amount_bdt", NEW."total_bdt", NEW."cod_amount_due_bdt",
    NEW."delivery_snapshot", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."reference", OLD."customer_id", OLD."guest_cart_hash",
    OLD."guest_access_token_hash", OLD."guest_access_expires_at", OLD."quote_id",
    OLD."cart_revision", OLD."reservation_id", OLD."address_ciphertext",
    OLD."payment_method", OLD."collection_status", OLD."merchandise_gross_bdt",
    OLD."delivery_amount_bdt", OLD."total_bdt", OLD."cod_amount_due_bdt",
    OLD."delivery_snapshot", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Order ownership, address and financial snapshots are immutable';
  END IF;

  IF OLD."status" = 'confirmed'
     AND OLD."serviceability" = 'serviceable'
     AND OLD."fulfillment_status" = 'awaiting_dispatch' THEN
    IF NEW."status" <> 'confirmed'
       OR NEW."serviceability" <> 'serviceable'
       OR NEW."fulfillment_status" <> 'dispatched'
       OR OLD."dispatch_command_id" IS NOT NULL
       OR OLD."dispatch_request_fingerprint" IS NOT NULL
       OR OLD."delivery_operator" IS NOT NULL
       OR OLD."handoff_reference" IS NOT NULL
       OR OLD."dispatched_by" IS NOT NULL
       OR OLD."dispatched_at" IS NOT NULL
       OR NEW."dispatch_command_id" IS NULL
       OR NEW."dispatch_request_fingerprint" IS NULL
       OR NEW."delivery_operator" IS NULL
       OR NEW."dispatched_by" IS NULL
       OR NEW."dispatched_at" IS NULL
       OR NEW."dispatched_at" > clock_timestamp() THEN
      RAISE EXCEPTION 'A dispatch must be a complete confirmed COD Order handoff';
    END IF;

    SELECT "status" INTO reservation_status
    FROM "inventory"."stock_reservation"
    WHERE "id" = NEW."reservation_id"
    FOR UPDATE;
    IF reservation_status IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'The Order reservation must be consumed before dispatch';
    END IF;

    SELECT "reservation_id", "operation"
      INTO command_reservation_id, command_operation
    FROM "inventory"."reservation_command"
    WHERE "command_id" = NEW."dispatch_command_id";
    IF command_reservation_id IS DISTINCT FROM NEW."reservation_id"
       OR command_operation IS DISTINCT FROM 'consume' THEN
      RAISE EXCEPTION 'Dispatch requires its matching durable Inventory consume command';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'awaiting_confirmation'
     OR OLD."serviceability" <> 'pending_manual_review' THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review or confirmed dispatch may transition';
  END IF;
  IF NEW."dispatch_command_id" IS NOT NULL
     OR NEW."dispatch_request_fingerprint" IS NOT NULL
     OR NEW."delivery_operator" IS NOT NULL
     OR NEW."handoff_reference" IS NOT NULL
     OR NEW."dispatched_by" IS NOT NULL
     OR NEW."dispatched_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A pending Order cannot include dispatch evidence';
  END IF;
  IF NEW."status" IN ('confirmed', 'rejected')
     AND OLD."created_at" <= clock_timestamp() - interval '168 hours' THEN
    RAISE EXCEPTION 'Staff serviceability review must be completed before 7 days';
  END IF;
  IF NEW."status" = 'confirmed'
     AND (NEW."serviceability" <> 'serviceable' OR NEW."fulfillment_status" <> 'awaiting_dispatch'
          OR NEW."cancellation_reason" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'A confirmed COD Order must be serviceable and await dispatch';
  END IF;
  IF NEW."status" = 'rejected'
     AND (NEW."serviceability" <> 'unserviceable' OR NEW."fulfillment_status" <> 'cancelled'
          OR NEW."cancellation_reason" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'A rejected COD Order must be unserviceable and cancelled';
  END IF;
  IF NEW."status" = 'cancelled'
     AND (NEW."serviceability" <> 'pending_manual_review'
          OR NEW."fulfillment_status" <> 'cancelled'
          OR NEW."cancellation_reason" <> 'serviceability_review_timeout'
          OR NEW."cancelled_at" IS NULL
          OR NEW."cancelled_at" < NEW."created_at" + interval '168 hours'
          OR NEW."cancelled_at" > clock_timestamp()) THEN
    RAISE EXCEPTION 'A pending COD Order may timeout only after 7 days';
  END IF;
  IF NEW."status" NOT IN ('confirmed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Only a pending manual serviceability review may transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ADD CONSTRAINT "snapshot_amount_check" CHECK ("quote"."snapshot"."delivery_amount_bdt" between 1 and 9007199254740991 and "quote"."snapshot"."merchandise_gross_bdt" between 0 and 9007199254740991 and "quote"."snapshot"."total_bdt" between 1 and 9007199254740991 and "quote"."snapshot"."total_bdt" = "quote"."snapshot"."merchandise_gross_bdt" + "quote"."snapshot"."delivery_amount_bdt");--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD CONSTRAINT "order_snapshot_object_check" CHECK (jsonb_typeof("orders"."order_header"."delivery_snapshot") = 'object');--> statement-breakpoint

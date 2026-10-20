CREATE TABLE "delivery"."tariff_area" (
	"tariff_version" text NOT NULL,
	"geography_version" text NOT NULL,
	"location_id" uuid NOT NULL,
	"zone" text NOT NULL,
	CONSTRAINT "tariff_area_tariff_version_location_id_pk" PRIMARY KEY("tariff_version","location_id"),
	CONSTRAINT "tariff_area_zone_check" CHECK ("delivery"."tariff_area"."zone" in ('inside_dhaka', 'suburban', 'outside_dhaka'))
);
--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD COLUMN IF NOT EXISTS "geography_version" text;--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD COLUMN IF NOT EXISTS "inside_dhaka_fee_bdt" integer;--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD COLUMN IF NOT EXISTS "suburban_fee_bdt" integer;--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD COLUMN IF NOT EXISTS "outside_dhaka_fee_bdt" integer;--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ADD COLUMN IF NOT EXISTS "delivery_zone" text;--> statement-breakpoint
ALTER TABLE "delivery"."tariff_area" ADD CONSTRAINT "tariff_area_tariff_version_tariff_version_fk" FOREIGN KEY ("tariff_version") REFERENCES "delivery"."tariff"("version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."tariff_area" ADD CONSTRAINT "tariff_area_geography_fk" FOREIGN KEY ("geography_version","location_id") REFERENCES "geography"."location"("snapshot_version","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD CONSTRAINT "tariff_geography_version_snapshot_version_fk" FOREIGN KEY ("geography_version") REFERENCES "geography"."snapshot"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."tariff" DROP CONSTRAINT IF EXISTS "tariff_zone_fee_group_check";--> statement-breakpoint
ALTER TABLE "delivery"."tariff" ADD CONSTRAINT "tariff_zone_fee_group_check" CHECK (("delivery"."tariff"."inside_dhaka_fee_bdt" is null and "delivery"."tariff"."suburban_fee_bdt" is null and "delivery"."tariff"."outside_dhaka_fee_bdt" is null and "delivery"."tariff"."geography_version" is null) or ("delivery"."tariff"."inside_dhaka_fee_bdt" is not null and "delivery"."tariff"."inside_dhaka_fee_bdt" between 1 and 2147483647 and "delivery"."tariff"."suburban_fee_bdt" is not null and "delivery"."tariff"."suburban_fee_bdt" between 1 and 2147483647 and "delivery"."tariff"."outside_dhaka_fee_bdt" is not null and "delivery"."tariff"."outside_dhaka_fee_bdt" between 1 and 2147483647 and "delivery"."tariff"."geography_version" is not null));--> statement-breakpoint
ALTER TABLE "quote"."snapshot" DROP CONSTRAINT IF EXISTS "snapshot_delivery_zone_check";--> statement-breakpoint
ALTER TABLE "quote"."snapshot" ADD CONSTRAINT "snapshot_delivery_zone_check" CHECK ("quote"."snapshot"."delivery_zone" is null or "quote"."snapshot"."delivery_zone" in ('inside_dhaka', 'suburban', 'outside_dhaka'));

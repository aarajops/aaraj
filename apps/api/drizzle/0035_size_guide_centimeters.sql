ALTER TABLE "catalog"."size_guide_measurement" RENAME COLUMN "value_mm" TO "value_cm";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" DROP CONSTRAINT "size_guide_measurement_value_check";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" ALTER COLUMN "value_cm" TYPE numeric(8, 3) USING ("value_cm" / 10)::numeric(8, 3);--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" ADD CONSTRAINT "size_guide_measurement_value_check" CHECK ("catalog"."size_guide_measurement"."value_cm" > 0);

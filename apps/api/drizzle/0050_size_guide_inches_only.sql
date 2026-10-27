ALTER TABLE "catalog"."size_guide" DROP CONSTRAINT "size_guide_input_unit_check";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" DROP CONSTRAINT "size_guide_measurement_value_check";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" ALTER COLUMN "value_cm" TYPE numeric(10, 5) USING ("value_cm" / 2.54)::numeric(10, 5);--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" RENAME COLUMN "value_cm" TO "value_in";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" DROP COLUMN "input_unit";--> statement-breakpoint
ALTER TABLE "catalog"."size_guide_measurement" ADD CONSTRAINT "size_guide_measurement_value_check" CHECK ("catalog"."size_guide_measurement"."value_in" > 0);

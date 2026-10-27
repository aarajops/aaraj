ALTER TABLE "catalog"."size_guide_measurement"
  ALTER COLUMN "value_in" TYPE numeric(6, 1)
  USING round("value_in", 1)::numeric(6, 1);

import { z } from "zod";

export const BANGLADESH_GEOGRAPHY_SCHEMA_VERSION = 1 as const;
export const BANGLADESH_GEOGRAPHY_VERSION =
  "BANGLADESH_GOVERNMENT_2026_10_08_V2" as const;

export const BangladeshGeographyLevelSchema = z.enum([
  "division",
  "district",
  "upazila",
]);

export const BangladeshGeographyLocationSchema = z.strictObject({
  id: z.uuid(),
  level: BangladeshGeographyLevelSchema,
  parentId: z.uuid().nullable(),
  name: z.string().min(1).max(120),
});
export type BangladeshGeographyLocation = z.infer<
  typeof BangladeshGeographyLocationSchema
>;

export const BangladeshGeographySchema = z.strictObject({
  schemaVersion: z.literal(BANGLADESH_GEOGRAPHY_SCHEMA_VERSION),
  datasetVersion: z.string().min(1).max(80),
  authority: z.enum([
    "Bangladesh National Portal",
    "Bangladesh National Portal and Bangladesh Government Press (Cabinet Division)",
  ]),
  snapshotDate: z.iso.date(),
  locations: z.array(BangladeshGeographyLocationSchema),
});
export type BangladeshGeography = z.infer<typeof BangladeshGeographySchema>;

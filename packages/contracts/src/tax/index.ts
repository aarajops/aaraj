import { z } from "zod";

export const TaxSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  approvedProfileAvailable: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type TaxSettings = z.infer<typeof TaxSettingsSchema>;

export const TaxSettingsUpdateSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export type TaxSettingsUpdate = z.infer<typeof TaxSettingsUpdateSchema>;

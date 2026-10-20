import { z } from "zod";

export const DeliveryZoneSchema = z.enum([
  "inside_dhaka",
  "suburban",
  "outside_dhaka",
]);
export type DeliveryZone = z.infer<typeof DeliveryZoneSchema>;

export const DeliveryZoneFeesSchema = z.strictObject({
  insideDhakaBdt: z.number().int().min(1).max(2_147_483_647),
  suburbanBdt: z.number().int().min(1).max(2_147_483_647),
  outsideDhakaBdt: z.number().int().min(1).max(2_147_483_647),
});
export type DeliveryZoneFees = z.infer<typeof DeliveryZoneFeesSchema>;

export const DeliveryAreaRuleSchema = z.strictObject({
  locationId: z.uuid(),
  level: z.enum(["district", "upazila"]),
  zone: DeliveryZoneSchema,
});
export type DeliveryAreaRule = z.infer<typeof DeliveryAreaRuleSchema>;

const DeliveryTariffPlanBaseSchema = {
  version: z.string().min(1).max(80),
  effectiveFrom: z.iso.date(),
};

export const DeliveryTariffPlanSchema = z.discriminatedUnion("pricingModel", [
  z.strictObject({
    ...DeliveryTariffPlanBaseSchema,
    geographyVersion: z.null(),
    pricingModel: z.literal("district"),
    fees: z.null(),
    areaRules: z.array(DeliveryAreaRuleSchema).length(0),
  }),
  z.strictObject({
    ...DeliveryTariffPlanBaseSchema,
    geographyVersion: z.string().min(1).max(80),
    pricingModel: z.literal("zones"),
    fees: DeliveryZoneFeesSchema,
    areaRules: z.array(DeliveryAreaRuleSchema),
  }),
]);
export type DeliveryTariffPlan = z.infer<typeof DeliveryTariffPlanSchema>;

export const DeliveryTariffConfigurationSchema = z.discriminatedUnion(
  "pricingModel",
  [
    z.strictObject({
      pricingModel: z.literal("district"),
      fees: z.null(),
      areaRules: z.array(DeliveryAreaRuleSchema).length(0),
    }),
    z.strictObject({
      pricingModel: z.literal("zones"),
      fees: DeliveryZoneFeesSchema,
      areaRules: z.array(DeliveryAreaRuleSchema),
    }),
  ],
);
export type DeliveryTariffConfiguration = z.infer<
  typeof DeliveryTariffConfigurationSchema
>;

export const DeliveryTariffManagementSchema = z.strictObject({
  current: DeliveryTariffConfigurationSchema,
  geographyVersion: z.string().min(1).max(80),
});
export type DeliveryTariffManagement = z.infer<
  typeof DeliveryTariffManagementSchema
>;

export const DeliveryTariffUpdateSchema = z
  .strictObject({
    geographyVersion: z.string().min(1).max(80),
    fees: DeliveryZoneFeesSchema,
    areaRules: z.array(DeliveryAreaRuleSchema),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((value, context) => {
    const locations = new Set<string>();
    value.areaRules.forEach((rule, index) => {
      if (locations.has(rule.locationId)) {
        context.addIssue({
          code: "custom",
          path: ["areaRules", index, "locationId"],
          message: "Each location can have one delivery zone.",
        });
      }
      locations.add(rule.locationId);
    });
  });
export type DeliveryTariffUpdate = z.infer<typeof DeliveryTariffUpdateSchema>;

export * from "./pathao.js";

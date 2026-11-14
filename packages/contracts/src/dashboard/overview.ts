import { z } from "zod";

export const DashboardRangeSchema = z.enum(["7d", "30d", "90d"]);
export type DashboardRange = z.infer<typeof DashboardRangeSchema>;

export const DashboardOverviewQuerySchema = z.strictObject({
  range: DashboardRangeSchema.default("30d"),
});
export type DashboardOverviewQuery = z.infer<
  typeof DashboardOverviewQuerySchema
>;

const NonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const SafeAmountSchema = z
  .number()
  .int()
  .max(Number.MAX_SAFE_INTEGER)
  .min(-Number.MAX_SAFE_INTEGER);

export const DashboardOverviewSchema = z.strictObject({
  range: DashboardRangeSchema,
  timezone: z.literal("Asia/Dhaka"),
  from: z.iso.date(),
  through: z.iso.date(),
  summary: z.strictObject({
    ordersPlaced: NonnegativeSafeIntegerSchema,
    cancelledOrders: NonnegativeSafeIntegerSchema,
    currentCodValueBdt: NonnegativeSafeIntegerSchema,
    codReconciledBdt: SafeAmountSchema,
    reconciliationChanges: NonnegativeSafeIntegerSchema,
  }),
  operations: z.strictObject({
    awaitingStaffAction: NonnegativeSafeIntegerSchema,
    awaitingDispatch: NonnegativeSafeIntegerSchema,
    inDelivery: NonnegativeSafeIntegerSchema,
    deliveryOutcomeOrders: NonnegativeSafeIntegerSchema,
    collectionDiscrepancies: NonnegativeSafeIntegerSchema,
  }),
  daily: z
    .array(
      z.strictObject({
        date: z.iso.date(),
        ordersPlaced: NonnegativeSafeIntegerSchema,
        currentCodValueBdt: NonnegativeSafeIntegerSchema,
        codReconciledBdt: SafeAmountSchema,
      }),
    )
    .min(7)
    .max(90),
  topProducts: z
    .array(
      z.strictObject({
        productName: z.string().min(1).max(160),
        color: z.string().max(80).nullable(),
        sizeLabel: z.string().max(40).nullable(),
        orderedUnits: NonnegativeSafeIntegerSchema,
      }),
    )
    .max(5),
});
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;

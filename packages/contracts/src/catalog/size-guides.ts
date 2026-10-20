import { z } from "zod";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";
import { CatalogCategoryReferenceSchema } from "./categories.js";

export const CatalogMeasurementBasisSchema = z.enum(["garment", "body"]);
export type CatalogMeasurementBasis = z.infer<
  typeof CatalogMeasurementBasisSchema
>;

export const CatalogMeasurementUnitSchema = z.enum(["cm", "in"]);
export type CatalogMeasurementUnit = z.infer<
  typeof CatalogMeasurementUnitSchema
>;

export function convertCatalogMeasurementValue(
  value: string,
  from: CatalogMeasurementUnit,
  to: CatalogMeasurementUnit,
  fractionDigits: 0 | 1 | 2 | 3 = 3,
): string {
  if (value === "") return value;

  const match = /^(\d{1,5})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return value;

  const thousandths =
    BigInt(match[1] ?? "0") * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
  const scale = 10n ** BigInt(fractionDigits);
  const [numerator, denominator] =
    from === to
      ? [thousandths * scale, 1000n]
      : from === "cm"
        ? [thousandths * scale, 2540n]
        : [thousandths * 254n * scale, 100000n];
  const converted = (numerator + denominator / 2n) / denominator;
  const whole = converted / scale;
  if (fractionDigits === 0) return `${whole}`;
  const fraction = String(converted % scale).padStart(fractionDigits, "0");

  return `${whole}.${fraction}`;
}

export const CatalogMeasurementKeySchema = z.enum([
  "chest_width",
  "body_length",
  "shoulder_width",
  "sleeve_length",
  "waist",
  "hip",
  "inseam",
  "outseam",
  "rise",
  "thigh",
  "hem",
]);
export type CatalogMeasurementKey = z.infer<typeof CatalogMeasurementKeySchema>;

export const CatalogSizeGuideMeasurementSchema = z.strictObject({
  key: CatalogMeasurementKeySchema,
  valueCm: z.string().regex(/^\d{1,5}\.\d{3}$/),
});

export const CatalogSizeGuideRowSchema = z.strictObject({
  id: z.uuid(),
  sizeLabel: z.string().min(1).max(40),
  sortOrder: z.number().int().nonnegative(),
  measurements: CatalogSizeGuideMeasurementSchema.array(),
});

export const CatalogSizeGuideSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  category: CatalogCategoryReferenceSchema,
  fit: z.string().min(1).max(80).nullable(),
  measurementBasis: CatalogMeasurementBasisSchema,
  rows: CatalogSizeGuideRowSchema.array(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogSizeGuide = z.infer<typeof CatalogSizeGuideSchema>;

export const CatalogSizeGuideSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  category: CatalogCategoryReferenceSchema,
  fit: z.string().min(1).max(80).nullable(),
  measurementBasis: CatalogMeasurementBasisSchema,
  sizeLabels: z.string().min(1).max(40).array(),
  updatedAt: z.iso.datetime(),
});
export type CatalogSizeGuideSummary = z.infer<
  typeof CatalogSizeGuideSummarySchema
>;

export const CatalogSizeGuidePageSchema = z.strictObject({
  guides: CatalogSizeGuideSummarySchema.array(),
  ...OffsetPaginationMetadataSchema.shape,
});
export type CatalogSizeGuidePage = z.infer<typeof CatalogSizeGuidePageSchema>;

export const CatalogSizeGuideCreateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    categoryId: z.uuid(),
    fit: z.string().trim().min(1).max(80).nullable().optional(),
    measurementBasis: CatalogMeasurementBasisSchema,
    inputUnit: CatalogMeasurementUnitSchema,
    rows: z
      .array(
        z.strictObject({
          sizeLabel: z.string().trim().min(1).max(40),
          measurements: z
            .array(
              z.strictObject({
                key: CatalogMeasurementKeySchema,
                value: z
                  .string()
                  .regex(
                    /^(?=.*[1-9])\d{1,4}(?:\.\d{1,3})?$/,
                    "Measurements must be greater than zero and use up to three decimal places.",
                  ),
              }),
            )
            .min(1)
            .max(CatalogMeasurementKeySchema.options.length),
        }),
      )
      .min(1)
      .max(40),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .check(({ value, issues }) => {
    for (const issue of validateGuideRows(value)) {
      issues.push({
        code: "custom",
        ...issue,
        input: value,
        continue: true,
      });
    }
  });
export type CatalogSizeGuideCreateInput = z.input<
  typeof CatalogSizeGuideCreateSchema
>;

export const CatalogSizeGuideUpdateSchema = CatalogSizeGuideCreateSchema;
export type CatalogSizeGuideUpdateInput = z.input<
  typeof CatalogSizeGuideUpdateSchema
>;

const OptionalCatalogSizeGuideSearchSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).max(160).optional(),
);

export const CatalogSizeGuideListQuerySchema =
  OffsetPaginationQuerySchema.extend({
    search: OptionalCatalogSizeGuideSearchSchema,
    categoryId: z.uuid().optional(),
    fit: z.string().trim().min(1).max(80).optional(),
    measurementBasis: CatalogMeasurementBasisSchema.optional(),
  });
export type CatalogSizeGuideListQuery = z.infer<
  typeof CatalogSizeGuideListQuerySchema
>;

export const CatalogSizeGuideIdSchema = z.uuid();

function validateGuideRows(input: {
  fit?: string | null;
  rows: Array<{
    sizeLabel: string;
    measurements: Array<{ key: CatalogMeasurementKey; value: string }>;
  }>;
}): Array<{ path: (string | number)[]; message: string }> {
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  const sizeLabels = new Set<string>();
  let expectedKeys: string | null = null;

  for (const [rowIndex, row] of input.rows.entries()) {
    const sizeLabel = row.sizeLabel.trim().toLowerCase();
    if (sizeLabels.has(sizeLabel)) {
      issues.push({
        path: ["rows", rowIndex, "sizeLabel"],
        message: "Size labels must be unique within a guide.",
      });
    }
    sizeLabels.add(sizeLabel);

    const keys = row.measurements.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      issues.push({
        path: ["rows", rowIndex, "measurements"],
        message: "A measurement can appear only once per size.",
      });
    }
    const keySet = [...keys].sort().join(",");
    if (expectedKeys !== null && keySet !== expectedKeys) {
      issues.push({
        path: ["rows", rowIndex, "measurements"],
        message: "Every size row in a guide must use the same measurements.",
      });
    }
    expectedKeys ??= keySet;
  }
  return issues;
}

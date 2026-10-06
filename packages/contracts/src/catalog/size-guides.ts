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
  valueMm: z.string().regex(/^\d{1,6}\.\d{2}$/),
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
                value: z.string().regex(/^\d{1,4}(?:\.\d{1,3})?$/),
              }),
            )
            .min(1)
            .max(CatalogMeasurementKeySchema.options.length),
        }),
      )
      .min(1)
      .max(40),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine(validateGuideRows);
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

function validateGuideRows(
  input: {
    fit?: string | null;
    rows: Array<{
      sizeLabel: string;
      measurements: Array<{ key: CatalogMeasurementKey; value: string }>;
    }>;
  },
  context: z.RefinementCtx,
) {
  const sizeLabels = new Set<string>();
  let expectedKeys: string | null = null;

  for (const [rowIndex, row] of input.rows.entries()) {
    const sizeLabel = row.sizeLabel.trim().toLowerCase();
    if (sizeLabels.has(sizeLabel)) {
      context.addIssue({
        code: "custom",
        path: ["rows", rowIndex, "sizeLabel"],
        message: "Size labels must be unique within a guide.",
      });
    }
    sizeLabels.add(sizeLabel);

    const keys = row.measurements.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["rows", rowIndex, "measurements"],
        message: "A measurement can appear only once per size.",
      });
    }
    const keySet = [...keys].sort().join(",");
    if (expectedKeys !== null && keySet !== expectedKeys) {
      context.addIssue({
        code: "custom",
        path: ["rows", rowIndex, "measurements"],
        message: "Every size row in a guide must use the same measurements.",
      });
    }
    expectedKeys ??= keySet;
  }
}

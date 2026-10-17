import {
  CatalogMeasurementKeySchema,
  CatalogSizeGuideCreateSchema,
  type CatalogMeasurementKey,
  type CatalogSizeGuide,
  type CatalogSizeGuideCreateInput,
  type CatalogSizeGuideUpdateInput,
} from "@aaraj/contracts";
import { z } from "zod";

type MeasurementValues = Partial<Record<CatalogMeasurementKey, string>>;
interface GuideRowDraft {
  sizeLabel: string;
  values: MeasurementValues;
}

export interface GuideForm {
  id: string | null;
  name: string;
  categoryId: string;
  fit: string;
  measurementBasis: "garment" | "body";
  inputUnit: "cm" | "in";
  keys: CatalogMeasurementKey[];
  rows: GuideRowDraft[];
  reason: string;
}

export const blankGuideForm: GuideForm = {
  id: null,
  name: "",
  categoryId: "",
  fit: "",
  measurementBasis: "garment",
  inputUnit: "cm",
  keys: ["chest_width", "body_length"],
  rows: [],
  reason: "",
};

export type GuideSubmission =
  | { id: null; input: CatalogSizeGuideCreateInput }
  | { id: string; input: CatalogSizeGuideUpdateInput };

function toGuideSubmission(form: GuideForm): GuideSubmission {
  const input = {
    name: form.name.trim(),
    categoryId: form.categoryId,
    fit: form.fit.trim() || null,
    measurementBasis: form.measurementBasis,
    inputUnit: form.inputUnit,
    rows: form.rows.map((row) => ({
      sizeLabel: row.sizeLabel.trim(),
      measurements: form.keys.map((key) => ({
        key,
        value: row.values[key]?.trim() ?? "",
      })),
    })),
    reason: form.reason.trim(),
  };

  return form.id
    ? {
        id: form.id,
        input: input satisfies CatalogSizeGuideUpdateInput,
      }
    : {
        id: null,
        input: input satisfies CatalogSizeGuideCreateInput,
      };
}

function mapGuideIssuePath(
  path: PropertyKey[],
  selectedKeys: CatalogMeasurementKey[],
): Array<string | number> {
  const normalizedPath = path.filter(
    (part): part is string | number => typeof part !== "symbol",
  );
  if (normalizedPath[0] !== "rows") return normalizedPath;

  const rowIndex = normalizedPath[1];
  if (typeof rowIndex !== "number") return normalizedPath;
  if (normalizedPath[2] !== "measurements") return normalizedPath;

  const measurementIndex = normalizedPath[3];
  if (typeof measurementIndex !== "number") {
    return selectedKeys.length === 0 ? ["keys"] : ["rows", rowIndex];
  }

  const measurementKey = selectedKeys[measurementIndex];
  return measurementKey
    ? ["rows", rowIndex, "values", measurementKey]
    : ["rows", rowIndex];
}

export const guideFormSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    name: z.string(),
    categoryId: z.string(),
    fit: z.string(),
    measurementBasis: z.enum(["garment", "body"]),
    inputUnit: z.enum(["cm", "in"]),
    keys: CatalogMeasurementKeySchema.array(),
    rows: z.array(
      z.strictObject({
        sizeLabel: z.string(),
        values: z.record(CatalogMeasurementKeySchema, z.string().optional()),
      }),
    ),
    reason: z.string(),
  })
  .superRefine((form, context) => {
    const submission = toGuideSubmission(form);
    const validation = CatalogSizeGuideCreateSchema.safeParse(submission.input);

    if (!validation.success) {
      for (const issue of validation.error.issues) {
        if (
          form.keys.length === 0 &&
          issue.path[0] === "rows" &&
          issue.path[2] === "measurements"
        ) {
          continue;
        }
        context.addIssue({
          code: "custom",
          path: mapGuideIssuePath(issue.path, form.keys),
          message: issue.message,
        });
      }
    }

    form.rows.forEach((row, rowIndex) => {
      for (const key of form.keys) {
        const value = row.values[key]?.trim() ?? "";
        if (value && Number.isFinite(Number(value)) && Number(value) <= 0) {
          context.addIssue({
            code: "custom",
            path: ["rows", rowIndex, "values", key],
            message: "Measurements must be greater than zero.",
          });
        }
      }
    });

    if (form.keys.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["keys"],
        message: "Choose at least one measurement.",
      });
    }
  })
  .transform(toGuideSubmission);

export function toSizeGuideFormState(guide: CatalogSizeGuide): GuideForm {
  return {
    id: guide.id,
    name: guide.name,
    categoryId: guide.category.id,
    fit: guide.fit ?? "",
    measurementBasis: guide.measurementBasis,
    inputUnit: "cm",
    keys: guide.rows[0]?.measurements.map(({ key }) => key) ?? [],
    rows: guide.rows.map((row) => ({
      sizeLabel: row.sizeLabel,
      values: Object.fromEntries(
        row.measurements.map(({ key, valueCm }) => [
          key,
          valueCm,
        ]),
      ),
    })),
    reason: "",
  };
}

export function convertMeasurementUnit(
  value: string,
  from: GuideForm["inputUnit"],
  to: GuideForm["inputUnit"],
): string {
  if (!value || from === to) return value;
  const [whole, fraction = ""] = value.split(".");
  const thousandths = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  const converted =
    from === "cm"
      ? Math.floor((thousandths * 100 + 127) / 254)
      : Math.floor((thousandths * 254 + 50) / 100);
  return `${Math.floor(converted / 1000)}.${String(converted % 1000).padStart(3, "0")}`;
}

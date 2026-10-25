import {
  CatalogAudienceSchema,
  CatalogProductCreateSchema,
  CatalogProductUpdateSchema,
  type CatalogManagedProductDetail,
  type CatalogProductCreateInput,
  type CatalogProductUpdateInput,
  type CatalogSizeGuideSummary,
} from "@aaraj/contracts";
import { parseBdtPrice, formatBdtInput } from "@/features/catalog/price";
import { z } from "zod";

export type SizeGuideOption = CatalogSizeGuideSummary;
type Audience = "" | "men" | "women" | "unisex";
type VariantDraft = {
  sku: string;
  color: string;
  sizeLabel: string;
  priceBdt: string;
  gtin: string;
};

export interface ProductForm {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  audience: Audience;
  categoryId: string;
  fit: string;
  fabricComposition: string;
  careInstructions: string;
  sizeGuideId: string;
  variants: VariantDraft[];
  isPublished: boolean;
}

export const blankProductForm: ProductForm = {
  id: null,
  slug: "",
  name: "",
  description: "",
  audience: "",
  categoryId: "",
  fit: "",
  fabricComposition: "",
  careInstructions: "",
  sizeGuideId: "",
  variants: [],
  isPublished: false,
};

export type ProductSubmission =
  | { id: null; input: CatalogProductCreateInput }
  | { id: string; input: CatalogProductUpdateInput };

type PreparedProductSubmission =
  | {
      id: null;
      input: CatalogProductCreateInput;
      variantDraftIndices: number[];
    }
  | {
      id: string;
      input: CatalogProductUpdateInput;
      variantDraftIndices: number[];
    };

function prepareProductSubmission(
  form: ProductForm,
): PreparedProductSubmission {
  const variantDrafts = form.variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) =>
      [
        variant.sku,
        variant.color,
        variant.sizeLabel,
        variant.priceBdt,
        variant.gtin,
      ].some((value) => value.trim().length > 0),
    );
  const variants = variantDrafts.map(({ variant }) => {
    const amountBdt = parseBdtPrice(variant.priceBdt);
    return {
      sku: variant.sku.trim(),
      color: variant.color.trim(),
      sizeLabel: variant.sizeLabel.trim(),
      price: amountBdt === null ? null : { amountBdt },
      gtin: variant.gtin.trim() || null,
    };
  });
  const fields = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId || null,
    fit: form.fit.trim() || null,
    fabricComposition: form.fabricComposition.trim() || null,
    careInstructions: form.careInstructions.trim() || null,
    sizeGuideId: form.sizeGuideId || null,
    variants,
    isPublished: form.isPublished,
  };
  const variantDraftIndices = variantDrafts.map(({ index }) => index);

  if (form.id) {
    return {
      id: form.id,
      input: {
        ...fields,
        slug: form.slug.trim(),
        audience: form.audience || null,
      } satisfies CatalogProductUpdateInput,
      variantDraftIndices,
    };
  }

  return {
    id: null,
    input: {
      ...fields,
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      audience: form.audience as Exclude<Audience, "">,
    } satisfies CatalogProductCreateInput,
    variantDraftIndices,
  };
}

function toProductSubmission(form: ProductForm): ProductSubmission {
  const prepared = prepareProductSubmission(form);
  if (prepared.id === null) {
    return { id: null, input: prepared.input };
  }
  return { id: prepared.id, input: prepared.input };
}

function mapProductIssuePath(
  path: PropertyKey[],
  variantDraftIndices: number[],
): Array<string | number> {
  const normalizedPath = path.filter(
    (part): part is string | number => typeof part !== "symbol",
  );
  if (normalizedPath[0] !== "variants") return normalizedPath;

  const variantIndex = normalizedPath[1];
  if (typeof variantIndex !== "number") return normalizedPath;
  const draftIndex = variantDraftIndices[variantIndex] ?? variantIndex;
  const fieldPath = normalizedPath.slice(2);
  if (fieldPath[0] === "price") {
    return ["variants", draftIndex, "priceBdt"];
  }
  return ["variants", draftIndex, ...fieldPath];
}

export const productFormSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    audience: z.union([z.literal(""), CatalogAudienceSchema]),
    categoryId: z.string(),
    fit: z.string(),
    fabricComposition: z.string(),
    careInstructions: z.string(),
    sizeGuideId: z.string(),
    variants: z.array(
      z.strictObject({
        sku: z.string(),
        color: z.string(),
        sizeLabel: z.string(),
        priceBdt: z.string(),
        gtin: z.string(),
      }),
    ),
    isPublished: z.boolean(),
  })
  .superRefine((form, context) => {
    const submission = prepareProductSubmission(form);
    const validation = submission.id
      ? CatalogProductUpdateSchema.safeParse(submission.input)
      : CatalogProductCreateSchema.safeParse(submission.input);

    if (!validation.success) {
      for (const issue of validation.error.issues) {
        if (issue.path[0] === "audience" && !form.audience) continue;
        context.addIssue({
          code: "custom",
          path: mapProductIssuePath(issue.path, submission.variantDraftIndices),
          message: issue.message,
        });
      }
    }

    for (const [index, variant] of form.variants.entries()) {
      if (variant.priceBdt.trim() && parseBdtPrice(variant.priceBdt) === null) {
        context.addIssue({
          code: "custom",
          path: ["variants", index, "priceBdt"],
          message: "Enter each price as a whole BDT amount, for example 1999.",
        });
      }
    }

    if (!form.audience && (!form.id || form.isPublished)) {
      context.addIssue({
        code: "custom",
        path: ["audience"],
        message: "Choose an audience before saving.",
      });
    }

    if (form.isPublished) {
      if (!form.categoryId) {
        context.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: "Choose a category before publishing.",
        });
      }
      if (!form.sizeGuideId) {
        context.addIssue({
          code: "custom",
          path: ["sizeGuideId"],
          message: "Assign a matching size guide before publishing.",
        });
      }
      if (!submission.input.variants?.length) {
        context.addIssue({
          code: "custom",
          path: ["variants"],
          message: "Add at least one variant before publishing.",
        });
      }
      for (const [index, variant] of form.variants.entries()) {
        const hasValues = Object.values(variant).some(
          (value) => value.trim().length > 0,
        );
        if (hasValues && !variant.priceBdt.trim()) {
          context.addIssue({
            code: "custom",
            path: ["variants", index, "priceBdt"],
            message: "Enter a price for every variant before publishing.",
          });
        }
      }
    }
  })
  .transform(toProductSubmission);

export function toProductFormState(
  product: CatalogManagedProductDetail,
): ProductForm {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? "",
    audience: product.audience ?? "",
    categoryId: product.category?.id ?? "",
    fit: product.fit ?? "",
    fabricComposition: product.fabricComposition ?? "",
    careInstructions: product.careInstructions ?? "",
    sizeGuideId: product.sizeGuideId ?? "",
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      priceBdt: formatBdtInput(variant.price?.amountBdt ?? null),
      gtin: variant.gtin ?? "",
    })),
    isPublished: product.isPublished,
  };
}

export function withProductSizeGuide(
  guides: SizeGuideOption[],
  product: CatalogManagedProductDetail | undefined,
): SizeGuideOption[] {
  if (
    !product?.sizeGuide ||
    guides.some(({ id }) => id === product.sizeGuide?.id)
  ) {
    return guides;
  }
  return [toSizeGuideOption(product.sizeGuide), ...guides];
}

function toSizeGuideOption(
  guide: NonNullable<CatalogManagedProductDetail["sizeGuide"]>,
): SizeGuideOption {
  return {
    id: guide.id,
    name: guide.name,
    category: guide.category,
    fit: guide.fit,
    measurementBasis: guide.measurementBasis,
    sizeLabels: guide.rows.map(({ sizeLabel }) => sizeLabel),
    updatedAt: guide.updatedAt,
  };
}

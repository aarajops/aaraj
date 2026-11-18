import {
  CatalogAudienceSchema,
  CatalogComboConfigurationInputSchema,
  CatalogComboSelectionModeSchema,
  CatalogProductCreateSchema,
  CatalogProductUpdateSchema,
  MAX_COMBO_COMPONENTS,
  type CatalogManagedProductDetail,
  type CatalogProductCreateInput,
  type CatalogProductUpdateInput,
  type CatalogComboConfigurationInput,
  type CatalogComboSelectionMode,
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
  compareAtPriceBdt: string;
};

export interface ProductForm {
  id: string | null;
  productType: "single" | "combo";
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
  comboSelectionMode: CatalogComboSelectionMode;
  comboPriceBdt: string;
  comboItemCount: string;
  comboComponents: { productId: string; fixedColor: string }[];
  isPublished: boolean;
}

export const blankProductForm: ProductForm = {
  id: null,
  productType: "single",
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
  comboSelectionMode: "fixed_combo",
  comboPriceBdt: "",
  comboItemCount: "2",
  comboComponents: [],
  isPublished: false,
};

export type ProductSubmission =
  | {
      id: null;
      input: CatalogProductCreateInput;
      comboConfiguration: CatalogComboConfigurationInput | null;
    }
  | {
      id: string;
      input: CatalogProductUpdateInput;
      comboConfiguration: CatalogComboConfigurationInput | null;
    };

type PreparedProductSubmission =
  | {
      id: null;
      input: CatalogProductCreateInput;
      variantDraftIndices: number[];
      comboConfiguration: CatalogComboConfigurationInput | null;
    }
  | {
      id: string;
      input: CatalogProductUpdateInput;
      variantDraftIndices: number[];
      comboConfiguration: CatalogComboConfigurationInput | null;
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
        variant.compareAtPriceBdt,
      ].some((value) => value.trim().length > 0),
    );
  const variants =
    form.productType === "single"
      ? variantDrafts.map(({ variant }) => {
          const amountBdt = parseBdtPrice(variant.priceBdt);
          const compareAtAmountBdt = parseBdtPrice(variant.compareAtPriceBdt);
          return {
            sku: variant.sku.trim(),
            color: variant.color.trim(),
            sizeLabel: variant.sizeLabel.trim(),
            price: amountBdt === null ? null : { amountBdt },
            compareAtPrice:
              compareAtAmountBdt === null
                ? null
                : { amountBdt: compareAtAmountBdt },
          };
        })
      : undefined;
  const fields = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId || null,
    fit: form.fit.trim() || null,
    fabricComposition: form.fabricComposition.trim() || null,
    careInstructions: form.careInstructions.trim() || null,
    sizeGuideId: form.sizeGuideId || null,
    ...(variants ? { variants } : {}),
    isPublished: form.isPublished,
  };
  const comboPriceBdt = parseBdtPrice(form.comboPriceBdt);
  const comboConfiguration =
    form.productType === "combo" && comboPriceBdt !== null
      ? {
          selectionMode: form.comboSelectionMode,
          price: { amountBdt: comboPriceBdt },
          itemCount:
            form.comboSelectionMode === "fixed_combo"
              ? form.comboComponents.length
              : (parseBdtPrice(form.comboItemCount) ?? 0),
          components: form.comboComponents.map((component) => ({
            productId: component.productId,
            fixedColor:
              form.comboSelectionMode === "fixed_combo"
                ? component.fixedColor.trim() || null
                : null,
          })),
        }
      : null;
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
      comboConfiguration,
    };
  }

  return {
    id: null,
    input: {
      ...fields,
      productType: form.productType,
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      audience: form.audience as Exclude<Audience, "">,
    } satisfies CatalogProductCreateInput,
    variantDraftIndices,
    comboConfiguration,
  };
}

function toProductSubmission(form: ProductForm): ProductSubmission {
  const prepared = prepareProductSubmission(form);
  if (prepared.id === null) {
    return {
      id: null,
      input: prepared.input,
      comboConfiguration: prepared.comboConfiguration,
    };
  }
  return {
    id: prepared.id,
    input: prepared.input,
    comboConfiguration: prepared.comboConfiguration,
  };
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
  if (fieldPath[0] === "compareAtPrice") {
    return ["variants", draftIndex, "compareAtPriceBdt"];
  }
  return ["variants", draftIndex, ...fieldPath];
}

export const productFormSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    productType: z.enum(["single", "combo"]),
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
        compareAtPriceBdt: z.string(),
      }),
    ),
    comboSelectionMode: CatalogComboSelectionModeSchema,
    comboPriceBdt: z.string(),
    comboItemCount: z.string(),
    comboComponents: z.array(
      z.strictObject({ productId: z.string(), fixedColor: z.string() }),
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

    if (form.productType === "combo") {
      const amountBdt = parseBdtPrice(form.comboPriceBdt);
      if (amountBdt === null) {
        context.addIssue({
          code: "custom",
          path: ["comboPriceBdt"],
          message: "Enter a whole BDT combo price, for example 2999.",
        });
      }
      const minimumProducts = form.comboSelectionMode === "fixed_combo" ? 2 : 1;
      if (form.comboComponents.length < minimumProducts) {
        context.addIssue({
          code: "custom",
          path: ["comboComponents"],
          message:
            form.comboSelectionMode === "fixed_combo"
              ? "Choose at least two products for this fixed combo."
              : "Choose at least one existing product for customers to choose from.",
        });
      }
      if (
        form.comboSelectionMode !== "fixed_combo" &&
        (parseBdtPrice(form.comboItemCount) === null ||
          parseBdtPrice(form.comboItemCount)! < 2 ||
          parseBdtPrice(form.comboItemCount)! > MAX_COMBO_COMPONENTS)
      ) {
        context.addIssue({
          code: "custom",
          path: ["comboItemCount"],
          message: `Enter a combo size from 2 to ${MAX_COMBO_COMPONENTS} items.`,
        });
      }
      if (submission.comboConfiguration) {
        const comboValidation = CatalogComboConfigurationInputSchema.safeParse(
          submission.comboConfiguration,
        );
        if (!comboValidation.success) {
          for (const issue of comboValidation.error.issues) {
            const componentIndex = issue.path[1];
            const componentField = issue.path[2];
            if (
              issue.path[0] === "components" &&
              typeof componentIndex === "number" &&
              componentField === "productId"
            ) {
              const hasProductId = Boolean(
                form.comboComponents[componentIndex]?.productId,
              );
              context.addIssue({
                code: "custom",
                path: ["comboComponents", componentIndex, "productId"],
                message: hasProductId
                  ? issue.message === "Invalid UUID"
                    ? "Choose a valid existing single product."
                    : issue.message
                  : "Choose a single product for this combo item.",
              });
              continue;
            }
            if (issue.path[0] === "itemCount") {
              context.addIssue({
                code: "custom",
                path: ["comboItemCount"],
                message: issue.message,
              });
              continue;
            }
            if (
              issue.path[0] === "components" &&
              typeof componentIndex === "number" &&
              componentField === "fixedColor"
            ) {
              context.addIssue({
                code: "custom",
                path: ["comboComponents", componentIndex, "fixedColor"],
                message: "Choose a fixed color for this product.",
              });
              continue;
            }
            if (
              issue.path[0] === "components" &&
              issue.path.length === 1 &&
              form.comboComponents.length < minimumProducts
            ) {
              continue;
            }
            context.addIssue({
              code: "custom",
              path:
                issue.path[0] === "components"
                  ? ["comboComponents"]
                  : ["comboSelectionMode"],
              message:
                issue.path[0] === "components" &&
                issue.path.length === 1 &&
                form.comboComponents.length > MAX_COMBO_COMPONENTS
                  ? `A combo can include up to ${MAX_COMBO_COMPONENTS} products.`
                  : issue.message,
            });
          }
        }
      }
      if (form.isPublished && !submission.comboConfiguration) {
        context.addIssue({
          code: "custom",
          path: ["comboComponents"],
          message: "Configure this combo before publishing it.",
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
      if (
        variant.compareAtPriceBdt.trim() &&
        parseBdtPrice(variant.compareAtPriceBdt) === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["variants", index, "compareAtPriceBdt"],
          message:
            "Enter the regular price as a whole BDT amount, for example 2499.",
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

    if (form.isPublished && form.productType === "single") {
      if (!form.description.trim()) {
        context.addIssue({
          code: "custom",
          path: ["description"],
          message: "Add a product-specific description before publishing.",
        });
      }
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
    productType: product.productType,
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
      compareAtPriceBdt: formatBdtInput(
        variant.compareAtPrice?.amountBdt ?? null,
      ),
    })),
    comboSelectionMode: product.combo?.selectionMode ?? "fixed_combo",
    comboPriceBdt: formatBdtInput(product.combo?.price.amountBdt ?? null),
    comboItemCount: String(product.combo?.itemCount ?? 2),
    comboComponents:
      product.combo?.components.map((component) => ({
        productId: component.productId,
        fixedColor: component.fixedColor ?? "",
      })) ?? [],
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

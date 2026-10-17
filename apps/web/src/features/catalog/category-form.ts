import {
  CatalogCategoryCreateSchema,
  CatalogCategoryUpdateSchema,
  type CatalogCategory,
  type CatalogCategoryCreateInput,
  type CatalogCategoryUpdateInput,
} from "@aaraj/contracts";
import { z } from "zod";

export interface CategoryFormDraft {
  id: string | null;
  name: string;
  slug: string;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
}

export const emptyCategoryForm: CategoryFormDraft = {
  id: null,
  name: "",
  slug: "",
  parentId: "",
  sortOrder: "0",
  isActive: true,
};

export type CategorySubmission =
  | { id: null; input: CatalogCategoryCreateInput }
  | { id: string; input: CatalogCategoryUpdateInput };

function toCategorySubmission(form: CategoryFormDraft): CategorySubmission {
  const fields = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    parentId: form.parentId || null,
    sortOrder: Number(form.sortOrder),
  };

  if (form.id) {
    return {
      id: form.id,
      input: {
        ...fields,
        isActive: form.isActive,
      } satisfies CatalogCategoryUpdateInput,
    };
  }

  return {
    id: null,
    input: fields satisfies CatalogCategoryCreateInput,
  };
}

export const categoryFormSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string(),
    sortOrder: z.string().trim().regex(/^\d+$/, {
      error: "Enter a whole display order.",
    }),
    isActive: z.boolean(),
  })
  .superRefine((form, context) => {
    const submission = toCategorySubmission(form);
    const validation = submission.id
      ? CatalogCategoryUpdateSchema.safeParse(submission.input)
      : CatalogCategoryCreateSchema.safeParse(submission.input);

    if (!validation.success) {
      for (const issue of validation.error.issues) {
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
  })
  .transform(toCategorySubmission);

export function toCategoryFormState(
  category: CatalogCategory,
): CategoryFormDraft {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? "",
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
  };
}

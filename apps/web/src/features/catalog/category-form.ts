import {
  CatalogCategoryCreateSchema,
  CatalogCategoryUpdateSchema,
  type CatalogManagedCategory,
  type CatalogCategoryCreateInput,
  type CatalogCategoryUpdateInput,
} from "@aaraj/contracts";
import { z } from "zod";

export interface CategoryFormDraft {
  id: string | null;
  editRevision: number | null;
  name: string;
  slug: string;
  parentId: string;
  isActive: boolean;
}

export const emptyCategoryForm: CategoryFormDraft = {
  id: null,
  editRevision: null,
  name: "",
  slug: "",
  parentId: "",
  isActive: true,
};

export type CategorySubmission =
  | { id: null; input: CatalogCategoryCreateInput }
  | {
      id: string;
      editRevision: number;
      input: CatalogCategoryUpdateInput;
    };

function toCategorySubmission(form: CategoryFormDraft): CategorySubmission {
  const fields = {
    name: form.name.trim(),
    parentId: form.parentId || null,
  };

  if (form.id) {
    return {
      id: form.id,
      editRevision: form.editRevision ?? 0,
      input: {
        ...fields,
        slug: form.slug.trim(),
        isActive: form.isActive,
      } satisfies CatalogCategoryUpdateInput,
    };
  }

  return {
    id: null,
    input: {
      ...fields,
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
    } satisfies CatalogCategoryCreateInput,
  };
}

export const categoryFormSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    editRevision: z.number().int().positive().nullable(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((form, context) => {
    if (form.id && form.editRevision === null) {
      context.addIssue({
        code: "custom",
        path: ["editRevision"],
        message: "Reload this category before saving changes.",
      });
    }
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
  category: CatalogManagedCategory,
): CategoryFormDraft {
  return {
    id: category.id,
    editRevision: category.editRevision,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? "",
    isActive: category.isActive,
  };
}

"use client";

import {
  CatalogCategoryListSchema,
  CatalogCategorySchema,
  type CatalogCategory,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createCatalogCategory,
  fetchManagedCatalogCategories,
  updateCatalogCategory,
} from "@/features/catalog/catalog-client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryForm {
  id: string | null;
  name: string;
  slug: string;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
  reason: string;
}

const emptyForm: CategoryForm = {
  id: null,
  name: "",
  slug: "",
  parentId: "",
  sortOrder: "0",
  isActive: true,
  reason: "",
};
const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";

export function CategoryManager({
  initialCategories,
}: {
  initialCategories: CatalogCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<CategoryForm>({ defaultValues: emptyForm });
  const editingId = useWatch({ control, name: "id" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await requestCategories());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(readCategoryError(error));
    }
  }, []);

  async function saveCategory(form: CategoryForm) {
    setErrorMessage(null);
    setStatusMessage(null);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      parentId: form.parentId || null,
      sortOrder: Number(form.sortOrder),
      reason: form.reason.trim(),
    };

    try {
      const response = form.id
        ? await updateCatalogCategory(form.id, {
            ...payload,
            isActive: form.isActive,
          })
        : await createCatalogCategory(payload);
      if (!response.ok) {
        setErrorMessage(await readProblem(response));
        return;
      }
      const result = CatalogCategorySchema.safeParse(await response.json());
      if (!result.success) {
        setErrorMessage("The server returned an invalid category.");
        return;
      }
      setStatusMessage(form.id ? "Category updated." : "Category created.");
      reset(emptyForm);
      await loadCategories();
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    }
  }

  function editCategory(category: CatalogCategory) {
    setErrorMessage(null);
    setStatusMessage(null);
    reset({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId ?? "",
      sortOrder: String(category.sortOrder),
      isActive: category.isActive,
      reason: "",
    });
  }

  const parentOptions = categories
    .filter((category) => category.isActive && category.id !== editingId)
    .map((category) => ({ label: category.path, value: category.id }));

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-6xl">
        <Link
          className="text-sm text-primary hover:text-primary/80"
          href="/admin/catalog"
        >
          ← Back to products
        </Link>
        <p className="mt-8 text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ STAFF
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Product categories
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Manage the reusable category tree used by products and size guides.
          Assign products to active leaf categories.
        </p>

        {errorMessage && (
          <p
            className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p
            className="mt-6 rounded-xl border border-primary/30 bg-primary/10 p-4 text-foreground"
            role="status"
          >
            {statusMessage}
          </p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]">
          <section aria-labelledby="categories-heading">
            <h2 className="text-xl font-semibold" id="categories-heading">
              Category tree
            </h2>
            {categories.length === 0 ? (
              <p className="mt-4 rounded-xl border border-border bg-card/60 p-5 text-muted-foreground">
                No categories yet. Create the first category to enable product
                and size guide assignment.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {categories.map((category) => (
                  <li
                    className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/60 p-4"
                    key={category.id}
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{category.path}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        /{category.slug} · {category.isLeaf ? "Leaf" : "Parent"}{" "}
                        · {category.isActive ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <Button
                      className="h-auto shrink-0 px-3 py-2"
                      type="button"
                      variant="outline"
                      onClick={() => editCategory(category)}
                    >
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7">
            <h2 className="text-xl font-semibold">
              {editingId ? "Edit category" : "Create a category"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Slugs are stable storefront filter values. Categories in use can
              be renamed, but cannot be deactivated.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={handleSubmit(saveCategory)}
            >
              <Field>
                <FieldLabel htmlFor="category-name">Name</FieldLabel>
                <Input
                  className={fieldClassName}
                  id="category-name"
                  maxLength={80}
                  required
                  {...register("name", { required: true, maxLength: 80 })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="category-slug">Slug</FieldLabel>
                <Input
                  className={fieldClassName}
                  id="category-slug"
                  maxLength={100}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  required
                  {...register("slug", { required: true, maxLength: 100 })}
                />
                <FieldDescription>
                  Used in storefront URLs; keep it stable once products use it.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel
                  id="category-parent-label"
                  htmlFor="category-parent"
                >
                  Parent category
                </FieldLabel>
                <Controller
                  control={control}
                  name="parentId"
                  render={({ field }) => (
                    <Select
                      items={[
                        { label: "Top level", value: null },
                        ...parentOptions,
                      ]}
                      name={field.name}
                      value={field.value || null}
                      onValueChange={(value) =>
                        field.onChange(typeof value === "string" ? value : "")
                      }
                    >
                      <SelectTrigger
                        id="category-parent"
                        aria-labelledby="category-parent-label"
                        ref={field.ref}
                        onBlur={field.onBlur}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>Top level</SelectItem>
                        {parentOptions.map((category) => (
                          <SelectItem
                            key={category.value}
                            value={category.value}
                          >
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="category-order">Display order</FieldLabel>
                <Input
                  className={fieldClassName}
                  id="category-order"
                  max={10000}
                  min={0}
                  required
                  type="number"
                  {...register("sortOrder", { required: true })}
                />
              </Field>
              {editingId && (
                <Field className="flex flex-row items-center gap-2">
                  <input
                    id="category-active"
                    type="checkbox"
                    {...register("isActive")}
                  />
                  <FieldLabel htmlFor="category-active">Active</FieldLabel>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="category-reason">
                  Reason for change
                </FieldLabel>
                <Input
                  className={fieldClassName}
                  id="category-reason"
                  maxLength={500}
                  minLength={3}
                  required
                  {...register("reason", { required: true, minLength: 3 })}
                />
              </Field>
              <div className="flex gap-3 pt-2">
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting
                    ? "Saving…"
                    : editingId
                      ? "Save category"
                      : "Create category"}
                </Button>
                {editingId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reset(emptyForm)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      </div>
    </main>
  );
}

async function readProblem(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  } catch {
    // Use the status fallback below for an empty or malformed response.
  }
  return `Category change failed (${response.status}).`;
}

async function requestCategories(): Promise<CatalogCategory[]> {
  const response = await fetchManagedCatalogCategories();
  if (response.status === 401) throw new Error("Sign in to manage categories.");
  if (response.status === 403) {
    throw new Error("Only administrators can manage product categories.");
  }
  if (!response.ok) throw new Error("Categories could not be loaded.");
  const result = CatalogCategoryListSchema.safeParse(await response.json());
  if (!result.success) throw new Error("The category response was invalid.");
  return result.data.categories;
}

function readCategoryError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Categories are temporarily unavailable.";
}

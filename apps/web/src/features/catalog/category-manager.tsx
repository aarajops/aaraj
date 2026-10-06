"use client";

import {
  CatalogCategorySchema,
  type CatalogCategory,
} from "@aaraj/contracts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createCatalogCategory,
  updateCatalogCategory,
} from "@/features/catalog/catalog-client";
import { CategoryTable } from "@/features/catalog/category-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
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
  view = "list",
  initialCategories,
  initialCategory,
  query = { limit: 50, offset: 0 },
}: {
  view?: "list" | "create" | "edit";
  initialCategories: CatalogCategory[];
  initialCategory?: CatalogCategory;
  query?: {
    limit: number;
    offset: number;
    search?: string;
    status?: "active" | "inactive";
    kind?: "parent" | "leaf";
  };
}) {
  const router = useRouter();
  const categories = initialCategories;
  const {
    control,
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CategoryForm>({
    defaultValues: initialCategory
      ? toCategoryFormState(initialCategory)
      : emptyForm,
  });
  const editingId = useWatch({ control, name: "id" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function saveCategory(form: CategoryForm) {
    setErrorMessage(null);
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
        const problem = await readApiErrorResponse(response);
        setErrorMessage(
          getApiErrorMessage(problem) ??
            "The API returned an unreadable error response.",
        );
        return;
      }
      const result = CatalogCategorySchema.safeParse(await response.json());
      if (!result.success) {
        setErrorMessage("The server returned an invalid category.");
        return;
      }
      router.replace("/admin/catalog/categories");
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    }
  }

  const parentOptions = categories
    .filter((category) => category.isActive && category.id !== editingId)
    .map((category) => ({ label: category.path, value: category.id }));

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href={view !== "list" ? "/admin/catalog/categories" : "/admin/catalog"}
          >
            {view !== "list" ? "← Back to categories" : "← Back to products"}
          </Link>
          {view === "list" && (
            <Link
              className={buttonVariants({ size: "lg" })}
              href="/admin/catalog/categories/create"
            >
              Create category
            </Link>
          )}
        </div>
        <p className="mt-8 text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ STAFF
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {view === "create"
            ? "Create category"
            : view === "edit"
              ? "Edit category"
              : "Product categories"}
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
        <div className="mt-8">
          {view === "list" && <section aria-labelledby="categories-heading">
            <h2 className="text-xl font-semibold" id="categories-heading">
              Category tree
            </h2>
            <div className="mt-4">
              <CategoryTable
                categories={categories}
                query={query}
                onRefresh={() => router.refresh()}
              />
            </div>
          </section>}

          {view !== "list" && <Card className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7">
            <h2 className="text-xl font-semibold">
              {view === "edit" ? "Edit category" : "Create a category"}
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
                <Link className={buttonVariants({ variant: "outline" })} href="/admin/catalog/categories">
                  Cancel
                </Link>
              </div>
            </form>
          </Card>}
        </div>
      </div>
    </main>
  );
}

function toCategoryFormState(category: CatalogCategory): CategoryForm {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? "",
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
    reason: "",
  };
}

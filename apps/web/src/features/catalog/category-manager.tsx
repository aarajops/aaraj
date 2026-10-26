"use client";

import {
  CATALOG_CATEGORY_SLUG_MAX_LENGTH,
  CatalogCategorySchema,
  CatalogCategoryManagementListQuerySchema,
  CatalogCategorySlugSuggestionSchema,
  type CatalogCategory,
  type CatalogCategoryManagementListQuery,
  type CatalogCategoryPage,
} from "@aaraj/contracts";
import Image from "next/image";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createCatalogCategory,
  suggestCatalogCategorySlug,
  uploadCatalogCategoryImage,
  updateCatalogCategory,
} from "@/features/catalog/catalog-client";
import {
  categoryFormSchema,
  emptyCategoryForm,
  toCategoryFormState,
  type CategoryFormDraft,
  type CategorySubmission,
} from "@/features/catalog/category-form";
import { CategoryTable } from "@/features/catalog/category-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { hasDirtyFieldsExcept } from "@/lib/form-dirty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";
const defaultCategoryTableQuery =
  CatalogCategoryManagementListQuerySchema.parse({});

export function CategoryManager({
  view = "list",
  initialCategories = [],
  initialCategory,
  initialPage,
  query = defaultCategoryTableQuery,
}: {
  view?: "list" | "create" | "edit";
  initialCategories?: CatalogCategory[];
  initialCategory?: CatalogCategory;
  initialPage?: CatalogCategoryPage;
  query?: CatalogCategoryManagementListQuery;
}) {
  const router = useRouter();
  const categories = initialPage?.categories ?? initialCategories;
  const {
    control,
    register,
    handleSubmit,
    getFieldState,
    getValues,
    setError,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<CategoryFormDraft, unknown, CategorySubmission>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initialCategory
      ? toCategoryFormState(initialCategory)
      : emptyCategoryForm,
  });
  const categoryNameField = register("name");
  const editingId = useWatch({ control, name: "id" });
  const hasCategoryChanges = hasDirtyFieldsExcept(dirtyFields, ["id"]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const slugSuggestionRequestId = useRef(0);

  async function suggestCategorySlug(name: string) {
    const normalizedName = name.trim();
    if (editingId || dirtyFields.slug || !normalizedName) return;

    const requestId = ++slugSuggestionRequestId.current;
    try {
      const response = await suggestCatalogCategorySlug(normalizedName);
      if (!response.ok) return;
      const result = CatalogCategorySlugSuggestionSchema.safeParse(
        await response.json(),
      );
      if (
        !result.success ||
        requestId !== slugSuggestionRequestId.current ||
        getValues("name").trim() !== normalizedName ||
        getFieldState("slug").isDirty
      ) {
        return;
      }
      setValue("slug", result.data.slug, {
        shouldDirty: false,
        shouldValidate: true,
      });
    } catch {
      // The create endpoint generates the slug if a suggestion is unavailable.
    }
  }

  async function uploadCategoryImage() {
    const file = imageInput.current?.files?.[0];
    if (!editingId || !file) return;
    setImageUploading(true);
    setErrorMessage(null);
    try {
      const response = await uploadCatalogCategoryImage(editingId, file);
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        setErrorMessage(
          getApiErrorMessage(problem) ??
            "The category image could not be saved.",
        );
        return;
      }
      if (imageInput.current) imageInput.current.value = "";
      router.refresh();
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    } finally {
      setImageUploading(false);
    }
  }

  async function saveCategory(submission: CategorySubmission) {
    if (submission.id && !hasCategoryChanges) return;
    setErrorMessage(null);

    try {
      let response: Response;
      if (submission.id === null) {
        const input = { ...submission.input };
        if (!getFieldState("slug").isDirty) delete input.slug;
        response = await createCatalogCategory(input);
      } else {
        response = await updateCatalogCategory(submission.id, submission.input);
      }
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        const message = getApiErrorMessage(problem);
        if (problem?.errorCode === "CATALOG_CATEGORY_SLUG_TAKEN") {
          setError("slug", {
            type: "server",
            message: message ?? "That category slug is already in use.",
          });
          return;
        }
        setErrorMessage(
          message ?? "The API returned an unreadable error response.",
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
      <div className="container mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href={
              view !== "list" ? "/admin/catalog/categories" : "/admin/catalog"
            }
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
          Products use leaf categories. Size guides can cover a category and its
          subcategories.
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
          {view === "list" && initialPage && (
            <section aria-labelledby="categories-heading">
              <h2 className="text-xl font-semibold" id="categories-heading">
                Category directory
              </h2>
              <div className="mt-4">
                <CategoryTable
                  categories={categories}
                  query={query}
                  page={initialPage}
                  onRefresh={() => router.refresh()}
                />
              </div>
            </section>
          )}

          {view !== "list" && (
            <Card className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7">
              <h2 className="text-xl font-semibold">
                {view === "edit" ? "Edit category" : "Create a category"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Slugs are stable storefront filter values. Categories in use can
                be renamed, but cannot be deactivated.
              </p>
              <form
                className="mt-5 space-y-4"
                noValidate
                onSubmit={handleSubmit(saveCategory)}
              >
                <Field>
                  <FieldLabel htmlFor="category-name">Name</FieldLabel>
                  <Input
                    aria-describedby={
                      errors.name ? "category-name-error" : undefined
                    }
                    aria-invalid={Boolean(errors.name)}
                    className={fieldClassName}
                    id="category-name"
                    maxLength={80}
                    required
                    {...categoryNameField}
                    onBlur={(event) => {
                      void categoryNameField.onBlur(event);
                      void suggestCategorySlug(event.currentTarget.value);
                    }}
                  />
                  {errors.name && (
                    <FieldError id="category-name-error">
                      {errors.name.message}
                    </FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="category-slug">Slug</FieldLabel>
                  <Input
                    aria-describedby={
                      errors.slug
                        ? "category-slug-error category-slug-description"
                        : "category-slug-description"
                    }
                    aria-invalid={Boolean(errors.slug)}
                    className={fieldClassName}
                    id="category-slug"
                    maxLength={CATALOG_CATEGORY_SLUG_MAX_LENGTH}
                    {...register("slug")}
                  />
                  {errors.slug && (
                    <FieldError id="category-slug-error">
                      {errors.slug.message}
                    </FieldError>
                  )}
                  <FieldDescription id="category-slug-description">
                    {view === "edit"
                      ? "Used in storefront URLs. Keep it stable once in use."
                      : "Suggested from the name. Edit it if needed."}
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
                    render={({ field, fieldState }) => (
                      <>
                        <Select
                          items={[
                            { label: "Top level", value: null },
                            ...parentOptions,
                          ]}
                          name={field.name}
                          value={field.value || null}
                          onValueChange={(value) =>
                            field.onChange(
                              typeof value === "string" ? value : "",
                            )
                          }
                        >
                          <SelectTrigger
                            id="category-parent"
                            aria-labelledby="category-parent-label"
                            aria-describedby={
                              fieldState.error
                                ? "category-parent-error"
                                : undefined
                            }
                            aria-invalid={Boolean(fieldState.error)}
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
                        {fieldState.error && (
                          <FieldError id="category-parent-error">
                            {fieldState.error.message}
                          </FieldError>
                        )}
                      </>
                    )}
                  />
                </Field>
                {editingId && (
                  <Field>
                    <FieldLabel htmlFor="category-image">
                      Category artwork
                    </FieldLabel>
                    {initialCategory?.image && (
                      <Image
                        alt={initialCategory.name}
                        className="aspect-[3/4] w-40 rounded-lg object-cover"
                        height={initialCategory.image.height}
                        unoptimized
                        src={initialCategory.image.src}
                        width={initialCategory.image.width}
                      />
                    )}
                    <Input
                      accept="image/jpeg,image/png,image/webp"
                      disabled={imageUploading}
                      id="category-image"
                      ref={imageInput}
                      type="file"
                    />
                    <FieldDescription>
                      Upload a JPEG, PNG, or WebP image. It will be optimized
                      for the storefront.
                    </FieldDescription>
                    <Button
                      disabled={imageUploading}
                      type="button"
                      variant="outline"
                      onClick={() => void uploadCategoryImage()}
                    >
                      {imageUploading ? "Uploading…" : "Upload artwork"}
                    </Button>
                  </Field>
                )}
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
                <div className="flex gap-3 pt-2">
                  <Button
                    disabled={
                      isSubmitting ||
                      (Boolean(editingId) && !hasCategoryChanges)
                    }
                    type="submit"
                  >
                    {isSubmitting
                      ? "Saving…"
                      : editingId
                        ? "Save category"
                        : "Create category"}
                  </Button>
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    href="/admin/catalog/categories"
                  >
                    Cancel
                  </Link>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

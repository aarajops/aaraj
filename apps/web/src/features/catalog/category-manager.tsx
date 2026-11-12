"use client";

import {
  CATALOG_CATEGORY_SLUG_MAX_LENGTH,
  CatalogCategorySchema,
  CatalogCategoryManagementListQuerySchema,
  CatalogCategorySlugSuggestionSchema,
  type CatalogCategory,
  type CatalogCategoryOption,
  type CatalogCategoryManagementListQuery,
  type CatalogCategoryPage,
} from "@aaraj/contracts";
import Image from "next/image";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { HomepageCategoryManager } from "@/features/catalog/homepage-category-manager";
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
  homepageCategoryOptions = [],
  query = defaultCategoryTableQuery,
}: {
  view?: "list" | "create" | "edit";
  initialCategories?: CatalogCategory[];
  initialCategory?: CatalogCategory;
  initialPage?: CatalogCategoryPage;
  homepageCategoryOptions?: CatalogCategoryOption[];
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
    reset,
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
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categorySheetMode, setCategorySheetMode] = useState<"create" | "edit">(
    "create",
  );
  const [categorySheetCategory, setCategorySheetCategory] =
    useState<CatalogCategory | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const slugSuggestionRequestId = useRef(0);
  const formMode = view === "list" ? categorySheetMode : view;
  const formCategory =
    view === "list"
      ? (categories.find(({ id }) => id === categorySheetCategory?.id) ??
        categorySheetCategory)
      : initialCategory;

  function openCreateSheet() {
    slugSuggestionRequestId.current += 1;
    setCategorySheetMode("create");
    setCategorySheetCategory(null);
    setErrorMessage(null);
    if (imageInput.current) imageInput.current.value = "";
    reset(emptyCategoryForm);
    setCategorySheetOpen(true);
  }

  function openEditSheet(category: CatalogCategory) {
    slugSuggestionRequestId.current += 1;
    setCategorySheetMode("edit");
    setCategorySheetCategory(category);
    setErrorMessage(null);
    if (imageInput.current) imageInput.current.value = "";
    reset(toCategoryFormState(category));
    setCategorySheetOpen(true);
  }

  function handleCategorySheetOpenChange(open: boolean) {
    setCategorySheetOpen(open);
    if (!open) {
      slugSuggestionRequestId.current += 1;
      setCategorySheetCategory(null);
      setErrorMessage(null);
      if (imageInput.current) imageInput.current.value = "";
      reset(emptyCategoryForm);
    }
  }

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
      if (view === "list") {
        handleCategorySheetOpenChange(false);
        router.refresh();
      } else {
        router.replace("/admin/catalog/categories");
      }
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    }
  }

  const parentOptions = (
    view === "list"
      ? homepageCategoryOptions
      : categories.filter((category) => category.isActive)
  )
    .filter((category) => category.id !== editingId)
    .map((category) => ({ label: category.path, value: category.id }));
  const categoryFormFields = (
    <div className="space-y-4">
      {errorMessage && (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="category-name">Name</FieldLabel>
        <Input
          aria-describedby={errors.name ? "category-name-error" : undefined}
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
          {formMode === "edit"
            ? "Used in storefront URLs. Keep it stable once in use."
            : "Suggested from the name. Edit it if needed."}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel id="category-parent-label" htmlFor="category-parent">
          Parent category
        </FieldLabel>
        <Controller
          control={control}
          name="parentId"
          render={({ field, fieldState }) => (
            <>
              <Select
                items={[{ label: "Top level", value: null }, ...parentOptions]}
                name={field.name}
                value={field.value || null}
                onValueChange={(value) =>
                  field.onChange(typeof value === "string" ? value : "")
                }
              >
                <SelectTrigger
                  id="category-parent"
                  aria-labelledby="category-parent-label"
                  aria-describedby={
                    fieldState.error ? "category-parent-error" : undefined
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
                    <SelectItem key={category.value} value={category.value}>
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
        <FieldDescription>
          {formMode === "edit" && formCategory && !formCategory.isLeaf
            ? "This category groups child categories. Choose it as the parent when creating a child."
            : formMode === "edit" && formCategory?.parentId
              ? "This is a product category. You can change its parent or make it top level."
              : "Top level means no parent. Choose a parent here to make this a child category."}
        </FieldDescription>
      </Field>
      {editingId && (
        <Field>
          <FieldLabel htmlFor="category-image">Category artwork</FieldLabel>
          {formCategory?.image && (
            <Image
              alt={formCategory.name}
              className="aspect-3/4 w-40 rounded-lg object-cover"
              height={formCategory.image.height}
              unoptimized
              src={formCategory.image.src}
              width={formCategory.image.width}
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
            Upload a JPEG, PNG, or WebP image. It will be optimized for the
            storefront.
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
    </div>
  );

  return (
    <>
      <div>
        <AdminPageHeader
          title={
            view === "create"
              ? "Create category"
              : view === "edit"
                ? "Edit category"
                : "Product categories"
          }
          description="Organize the storefront catalog."
          backLink={
            view !== "list" && (
              <Link
                className={adminPageLinkClassName}
                href="/admin/catalog/categories"
              >
                ← Back to categories
              </Link>
            )
          }
          actions={
            view === "list" && (
              <>
                <HomepageCategoryManager categories={homepageCategoryOptions} />
                <Button onClick={openCreateSheet} size="lg" type="button">
                  Create category
                </Button>
              </>
            )
          }
        />

        <div className={view === "list" ? "mt-6" : "mt-8"}>
          {view === "list" && initialPage && (
            <CategoryTable
              categories={categories}
              query={query}
              page={initialPage}
              onEditCategory={openEditSheet}
              onRefresh={() => router.refresh()}
            />
          )}

          {view !== "list" && (
            <Card className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7">
              <h2 className="text-xl font-semibold">
                {formMode === "edit" ? "Edit category" : "Create a category"}
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
                {categoryFormFields}
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

      {view === "list" && (
        <Sheet
          onOpenChange={handleCategorySheetOpenChange}
          open={categorySheetOpen}
        >
          <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
            <SheetHeader className="border-b pr-12">
              <SheetTitle>
                {formMode === "edit" ? "Edit category" : "Create category"}
              </SheetTitle>
              <SheetDescription>
                Slugs stay stable in storefront URLs. Categories in use cannot
                be deactivated.
              </SheetDescription>
            </SheetHeader>
            <form
              className="flex min-h-0 flex-1 flex-col"
              noValidate
              onSubmit={handleSubmit(saveCategory)}
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {categoryFormFields}
              </div>
              <SheetFooter className="mt-0 flex-row justify-end border-t">
                <SheetClose
                  render={
                    <Button
                      disabled={isSubmitting}
                      type="button"
                      variant="outline"
                    />
                  }
                >
                  Cancel
                </SheetClose>
                <Button
                  disabled={
                    isSubmitting || (Boolean(editingId) && !hasCategoryChanges)
                  }
                  type="submit"
                >
                  {isSubmitting
                    ? "Saving…"
                    : editingId
                      ? "Save category"
                      : "Create category"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

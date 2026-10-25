"use client";

import {
  CatalogProductPageSchema,
  CatalogProductSchema,
  CatalogSizeGuidePageSchema,
  type CatalogCategoryOption,
  type CatalogManagedProductDetail,
  type CatalogProductListQuery,
  type CatalogProductPage,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCatalogProduct,
  fetchManagedSizeGuides,
  fetchManagedProducts,
  updateCatalogProduct,
} from "@/features/catalog/catalog-client";
import { CatalogCategorySelect } from "@/features/catalog/catalog-category-select";
import { CatalogMediaManager } from "@/features/catalog/catalog-media-manager";
import {
  blankProductForm,
  productFormSchema,
  toProductFormState,
  withProductSizeGuide,
  type ProductForm,
  type ProductSubmission,
  type SizeGuideOption,
} from "@/features/catalog/catalog-product-form";
import { ProductTable } from "@/features/catalog/product-table";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { hasDirtyFieldsExcept } from "@/lib/form-dirty-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";
export function CatalogManager({
  view = "list",
  initialPage,
  initialProduct,
  initialSizeGuides,
  initialSizeGuidesHasMore,
  initialSizeGuidesNextOffset,
  categoryOptions = [],
  query,
}: {
  view?: "list" | "create" | "edit";
  initialPage?: CatalogProductPage;
  initialProduct?: CatalogManagedProductDetail;
  initialSizeGuides?: SizeGuideOption[];
  initialSizeGuidesHasMore?: boolean;
  initialSizeGuidesNextOffset?: number | null;
  categoryOptions?: CatalogCategoryOption[];
  query: CatalogProductListQuery;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialPage?.products ?? []);
  const [sizeGuides, setSizeGuides] = useState(() =>
    withProductSizeGuide(initialSizeGuides ?? [], initialProduct),
  );
  const [hasMoreSizeGuides, setHasMoreSizeGuides] = useState(
    initialSizeGuidesHasMore ?? false,
  );
  const [nextSizeGuideOffset, setNextSizeGuideOffset] = useState(
    initialSizeGuidesNextOffset ?? null,
  );
  const [productPage, setProductPage] = useState(() =>
    initialPage
      ? {
          limit: initialPage.limit,
          offset: initialPage.offset,
          hasMore: initialPage.hasMore,
          nextOffset: initialPage.nextOffset,
        }
      : null,
  );
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProductForm, unknown, ProductSubmission>({
    resolver: zodResolver(productFormSchema),
    defaultValues: initialProduct
      ? toProductFormState(initialProduct)
      : blankProductForm,
  });
  const {
    fields: variantFields,
    append: appendVariant,
    remove: removeVariant,
  } = useFieldArray({ control, name: "variants" });
  const [editingId, categoryId, fit, sizeGuideId, isPublished] = useWatch({
    control,
    name: ["id", "categoryId", "fit", "sizeGuideId", "isPublished"],
  });
  const hasProductChanges = hasDirtyFieldsExcept(dirtyFields, ["id"]);
  const slugError = errors.slug?.message;
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [productRefreshError, setProductRefreshError] = useState<string | null>(
    null,
  );
  const productLoadRequestId = useRef(0);
  const [isLoadingSizeGuides, setIsLoadingSizeGuides] = useState(false);
  const [sizeGuideLoadError, setSizeGuideLoadError] = useState<string | null>(
    null,
  );

  const loadProducts = useCallback(async () => {
    const requestId = ++productLoadRequestId.current;
    setIsRefreshing(true);
    try {
      const response = await fetchManagedProducts(query);
      if (requestId !== productLoadRequestId.current) return;

      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        if (requestId !== productLoadRequestId.current) return;
        setProductRefreshError(
          getApiErrorMessage(problem) ??
            "The API returned an unreadable error response.",
        );
        return;
      }

      const payload: unknown = await response.json();
      if (requestId !== productLoadRequestId.current) return;
      const result = CatalogProductPageSchema.safeParse(payload);
      if (!result.success) throw new Error("Catalog response was invalid.");

      setProducts(result.data.products);
      setProductPage({
        limit: result.data.limit,
        offset: result.data.offset,
        hasMore: result.data.hasMore,
        nextOffset: result.data.nextOffset,
      });
      setProductRefreshError(null);
    } catch {
      if (requestId === productLoadRequestId.current) {
        setProductRefreshError(
          "Catalog management is temporarily unavailable.",
        );
      }
    } finally {
      if (requestId === productLoadRequestId.current) {
        setIsRefreshing(false);
      }
    }
  }, [query]);

  async function loadMoreSizeGuides() {
    if (isLoadingSizeGuides || nextSizeGuideOffset === null) return;

    setIsLoadingSizeGuides(true);
    setSizeGuideLoadError(null);
    try {
      const response = await fetchManagedSizeGuides({
        limit: 100,
        offset: nextSizeGuideOffset,
      });
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        setSizeGuideLoadError(
          getApiErrorMessage(problem) ??
            "The API returned an unreadable error response.",
        );
        return;
      }

      const result = CatalogSizeGuidePageSchema.safeParse(
        await response.json(),
      );
      if (!result.success) throw new Error("Size guide response was invalid.");

      setSizeGuides((current) => {
        const knownIds = new Set(current.map((guide) => guide.id));
        return [
          ...current,
          ...result.data.guides.filter((guide) => !knownIds.has(guide.id)),
        ];
      });
      setHasMoreSizeGuides(result.data.hasMore);
      setNextSizeGuideOffset(result.data.nextOffset);
    } catch {
      setSizeGuideLoadError("More size guides could not be loaded. Try again.");
    } finally {
      setIsLoadingSizeGuides(false);
    }
  }

  async function saveProduct(submission: ProductSubmission) {
    if (submission.id && !hasProductChanges) return;
    setFormErrorMessage(null);
    setErrorCode(null);

    try {
      const response =
        submission.id === null
          ? await createCatalogProduct(submission.input)
          : await updateCatalogProduct(submission.id, submission.input);

      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        setErrorCode(problem?.errorCode ?? null);
        setFormErrorMessage(
          getApiErrorMessage(problem) ??
            "The API returned an unreadable error response.",
        );
        return;
      }

      const result = CatalogProductSchema.safeParse(await response.json());
      if (!result.success) {
        setFormErrorMessage("The server returned an invalid product response.");
        return;
      }

      router.replace("/admin/catalog");
    } catch {
      setFormErrorMessage("Could not reach the server. Please try again.");
    }
  }

  const categoriesById = new Map(
    categoryOptions.map((category) => [category.id, category]),
  );
  const applicableCategoryIds = new Set<string>();
  const visitedCategoryIds = new Set<string>();
  let currentCategoryId: string | null = categoryId;
  while (currentCategoryId && !visitedCategoryIds.has(currentCategoryId)) {
    applicableCategoryIds.add(currentCategoryId);
    visitedCategoryIds.add(currentCategoryId);
    currentCategoryId = categoriesById.get(currentCategoryId)?.parentId ?? null;
  }
  const compatibleGuides = sizeGuides.filter(
    (guide) =>
      applicableCategoryIds.has(guide.category.id) &&
      (guide.fit ?? "").trim().toLowerCase() === fit.trim().toLowerCase(),
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="container mx-auto">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ STAFF
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {view === "create"
                ? "Create product"
                : view === "edit"
                  ? "Edit product"
                  : "Catalog management"}
            </h1>
            {view !== "list" && (
              <p className="mt-2 text-muted-foreground">
                {view === "create"
                  ? "Create one product per style, then add its real color and size options."
                  : "Update the product details, sellable variants, and storefront visibility."}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {view !== "list" ? (
              <Link
                className="text-sm text-primary hover:text-primary/80"
                href="/admin/catalog"
              >
                Back to products
              </Link>
            ) : (
              <Link
                className={buttonVariants({ size: "lg" })}
                href="/admin/catalog/create"
              >
                Create product
              </Link>
            )}
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/admin/catalog/size-guides"
            >
              Manage size guides
            </Link>
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/admin/catalog/categories"
            >
              Manage categories
            </Link>
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/shop"
            >
              View public catalog
            </Link>
          </div>
        </div>

        <div className="mt-10">
          {view === "list" && (
            <section aria-labelledby="managed-products-heading">
              <h2
                className="text-xl font-semibold"
                id="managed-products-heading"
              >
                Products
              </h2>
              {productRefreshError && (
                <div
                  className="mt-4 rounded-lg border border-destructive bg-background p-4 text-sm text-destructive"
                  role="alert"
                >
                  <p>{productRefreshError}</p>
                  {products.length > 0 && (
                    <p className="mt-1">
                      The product rows shown below may be outdated.
                    </p>
                  )}
                  <Button
                    className="mt-3"
                    disabled={isRefreshing}
                    onClick={() => void loadProducts()}
                    type="button"
                    variant="outline"
                  >
                    {isRefreshing ? "Retrying…" : "Retry product refresh"}
                  </Button>
                </div>
              )}
              <div className="mt-4">
                <ProductTable
                  products={products}
                  categoryOptions={categoryOptions}
                  query={query}
                  onRefresh={() => void loadProducts()}
                  isRefreshing={isRefreshing}
                  page={productPage}
                />
              </div>
            </section>
          )}

          {view !== "list" && (
            <Card
              aria-labelledby="product-form-heading"
              className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7"
              role="region"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    className="text-xl font-semibold"
                    id="product-form-heading"
                  >
                    {view === "edit" ? "Edit product" : "Create a product"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Drafts can be incomplete. Publishing requires sellable
                    variants and a matching size guide.
                  </p>
                </div>
              </div>

              <form
                className="mt-6 space-y-4"
                noValidate
                onSubmit={handleSubmit(saveProduct)}
              >
                <Field>
                  <FieldLabel htmlFor="product-name">Name</FieldLabel>
                  <Input
                    autoComplete="off"
                    aria-describedby={
                      errors.name ? "product-name-error" : undefined
                    }
                    aria-invalid={Boolean(errors.name)}
                    className={fieldClassName}
                    id="product-name"
                    maxLength={160}
                    required
                    {...register("name")}
                  />
                  {errors.name && (
                    <FieldError id="product-name-error">
                      {errors.name.message}
                    </FieldError>
                  )}
                </Field>

                <Field data-invalid={Boolean(slugError)}>
                  <FieldLabel htmlFor="product-slug">Slug</FieldLabel>
                  <Input
                    autoComplete="off"
                    aria-invalid={Boolean(slugError)}
                    className={fieldClassName}
                    id="product-slug"
                    aria-describedby={
                      slugError
                        ? "slug-error product-slug-description"
                        : "product-slug-description"
                    }
                    maxLength={120}
                    required
                    {...register("slug")}
                  />
                  {slugError && (
                    <FieldError id="slug-error">{slugError}</FieldError>
                  )}
                  <FieldDescription id="product-slug-description">
                    Use lowercase letters, numbers, and single hyphens.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="product-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    aria-describedby={
                      errors.description
                        ? "product-description-error"
                        : undefined
                    }
                    aria-invalid={Boolean(errors.description)}
                    className="min-h-24 resize-y bg-background px-3 py-2.5 text-base md:text-base"
                    id="product-description"
                    maxLength={5000}
                    {...register("description")}
                  />
                  {errors.description && (
                    <FieldError id="product-description-error">
                      {errors.description.message}
                    </FieldError>
                  )}
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel
                      id="product-audience-label"
                      htmlFor="product-audience"
                    >
                      Audience
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="audience"
                      render={({ field, fieldState }) => (
                        <>
                          <Select
                            items={[
                              { label: "Choose audience", value: null },
                              { label: "Men", value: "men" },
                              { label: "Women", value: "women" },
                              { label: "Unisex", value: "unisex" },
                            ]}
                            name={field.name}
                            required={!editingId || isPublished}
                            value={field.value || null}
                            onValueChange={(value) =>
                              field.onChange(
                                typeof value === "string" ? value : "",
                              )
                            }
                          >
                            <SelectTrigger
                              id="product-audience"
                              aria-labelledby="product-audience-label"
                              aria-describedby={
                                fieldState.error
                                  ? "product-audience-error"
                                  : undefined
                              }
                              aria-invalid={Boolean(fieldState.error)}
                              ref={field.ref}
                              onBlur={field.onBlur}
                            >
                              <SelectValue placeholder="Choose audience" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={null}>
                                Choose audience
                              </SelectItem>
                              <SelectItem value="men">Men</SelectItem>
                              <SelectItem value="women">Women</SelectItem>
                              <SelectItem value="unisex">Unisex</SelectItem>
                            </SelectContent>
                          </Select>
                          {fieldState.error && (
                            <FieldError id="product-audience-error">
                              {fieldState.error.message}
                            </FieldError>
                          )}
                        </>
                      )}
                    />
                  </Field>
                  <Controller
                    control={control}
                    name="categoryId"
                    render={({ field, fieldState }) => (
                      <CatalogCategorySelect
                        id="product-category"
                        label="Product category"
                        required={isPublished}
                        errorMessage={fieldState.error?.message}
                        value={field.value}
                        name={field.name}
                        triggerRef={field.ref}
                        onBlur={field.onBlur}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>

                <Field>
                  <FieldLabel htmlFor="product-fit">
                    Fit{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional, for example Regular)
                    </span>
                  </FieldLabel>
                  <Input
                    aria-describedby={
                      errors.fit ? "product-fit-error" : undefined
                    }
                    aria-invalid={Boolean(errors.fit)}
                    className={fieldClassName}
                    id="product-fit"
                    maxLength={80}
                    {...register("fit")}
                  />
                  {errors.fit && (
                    <FieldError id="product-fit-error">
                      {errors.fit.message}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="product-fabric">
                    Fabric composition{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FieldLabel>
                  <Input
                    aria-describedby={
                      errors.fabricComposition
                        ? "product-fabric-error"
                        : undefined
                    }
                    aria-invalid={Boolean(errors.fabricComposition)}
                    className={fieldClassName}
                    id="product-fabric"
                    maxLength={1000}
                    {...register("fabricComposition")}
                  />
                  {errors.fabricComposition && (
                    <FieldError id="product-fabric-error">
                      {errors.fabricComposition.message}
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="product-care">
                    Care instructions{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FieldLabel>
                  <Textarea
                    aria-describedby={
                      errors.careInstructions ? "product-care-error" : undefined
                    }
                    aria-invalid={Boolean(errors.careInstructions)}
                    className="min-h-20 resize-y bg-background px-3 py-2.5 text-base md:text-base"
                    id="product-care"
                    maxLength={2000}
                    {...register("careInstructions")}
                  />
                  {errors.careInstructions && (
                    <FieldError id="product-care-error">
                      {errors.careInstructions.message}
                    </FieldError>
                  )}
                </Field>

                <section
                  aria-labelledby="product-variants-heading"
                  aria-describedby={
                    errors.variants?.root ? "product-variants-error" : undefined
                  }
                  className="space-y-3 rounded-xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3
                        className="font-semibold"
                        id="product-variants-heading"
                      >
                        Color and size variants
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Each row is one sellable color and size with its own
                        SKU.
                      </p>
                    </div>
                    <Button
                      className="h-auto px-3 py-2"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        appendVariant({
                          sku: "",
                          color: "",
                          sizeLabel: "",
                          priceBdt: "",
                          gtin: "",
                        })
                      }
                    >
                      Add variant
                    </Button>
                  </div>
                  {variantFields.map((variant, index) => (
                    <fieldset
                      className="grid gap-3 rounded-lg bg-background/70 p-3 sm:grid-cols-2"
                      key={variant.id}
                    >
                      <legend className="sr-only">Variant {index + 1}</legend>
                      <div className="space-y-1 text-sm">
                        <label htmlFor={`variant-${index}-sku`}>SKU</label>
                        <Input
                          id={`variant-${index}-sku`}
                          aria-describedby={
                            errors.variants?.[index]?.sku
                              ? `variant-${index}-sku-error`
                              : undefined
                          }
                          aria-invalid={Boolean(errors.variants?.[index]?.sku)}
                          className={fieldClassName}
                          maxLength={100}
                          required
                          {...register(`variants.${index}.sku` as const)}
                        />
                        {errors.variants?.[index]?.sku && (
                          <FieldError id={`variant-${index}-sku-error`}>
                            {errors.variants[index].sku.message}
                          </FieldError>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        <label htmlFor={`variant-${index}-color`}>Color</label>
                        <Input
                          id={`variant-${index}-color`}
                          aria-describedby={
                            errors.variants?.[index]?.color
                              ? `variant-${index}-color-error`
                              : undefined
                          }
                          aria-invalid={Boolean(
                            errors.variants?.[index]?.color,
                          )}
                          className={fieldClassName}
                          maxLength={80}
                          required
                          {...register(`variants.${index}.color` as const)}
                        />
                        {errors.variants?.[index]?.color && (
                          <FieldError id={`variant-${index}-color-error`}>
                            {errors.variants[index].color.message}
                          </FieldError>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        <label htmlFor={`variant-${index}-size`}>Size</label>
                        <Input
                          id={`variant-${index}-size`}
                          aria-describedby={
                            errors.variants?.[index]?.sizeLabel
                              ? `variant-${index}-size-error`
                              : undefined
                          }
                          aria-invalid={Boolean(
                            errors.variants?.[index]?.sizeLabel,
                          )}
                          className={fieldClassName}
                          maxLength={40}
                          required
                          {...register(`variants.${index}.sizeLabel` as const)}
                        />
                        {errors.variants?.[index]?.sizeLabel && (
                          <FieldError id={`variant-${index}-size-error`}>
                            {errors.variants[index].sizeLabel.message}
                          </FieldError>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        <label htmlFor={`variant-${index}-price`}>
                          Price (BDT)
                        </label>
                        <Input
                          id={`variant-${index}-price`}
                          aria-describedby={
                            errors.variants?.[index]?.priceBdt
                              ? `variant-${index}-price-error variant-${index}-price-help`
                              : `variant-${index}-price-help`
                          }
                          aria-invalid={Boolean(
                            errors.variants?.[index]?.priceBdt,
                          )}
                          className={fieldClassName}
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="1999"
                          {...register(`variants.${index}.priceBdt` as const)}
                        />
                        {errors.variants?.[index]?.priceBdt && (
                          <FieldError id={`variant-${index}-price-error`}>
                            {errors.variants[index].priceBdt.message}
                          </FieldError>
                        )}
                        <span
                          className="block text-xs text-muted-foreground"
                          id={`variant-${index}-price-help`}
                        >
                          Enter whole BDT only. Use 0 for a free product.
                          Required to publish.
                        </span>
                      </div>
                      <div className="space-y-1 text-sm">
                        <label htmlFor={`variant-${index}-gtin`}>
                          GTIN{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </label>
                        <Input
                          id={`variant-${index}-gtin`}
                          aria-describedby={
                            errors.variants?.[index]?.gtin
                              ? `variant-${index}-gtin-error`
                              : undefined
                          }
                          aria-invalid={Boolean(errors.variants?.[index]?.gtin)}
                          className={fieldClassName}
                          inputMode="numeric"
                          maxLength={14}
                          {...register(`variants.${index}.gtin` as const)}
                        />
                        {errors.variants?.[index]?.gtin && (
                          <FieldError id={`variant-${index}-gtin-error`}>
                            {errors.variants[index].gtin.message}
                          </FieldError>
                        )}
                      </div>
                      <Button
                        className="h-auto justify-self-start px-2 py-1 text-sm text-destructive"
                        type="button"
                        variant="ghost"
                        onClick={() => removeVariant(index)}
                      >
                        Remove variant
                      </Button>
                    </fieldset>
                  ))}
                  {variantFields.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No variants added. Add them before publishing.
                    </p>
                  )}
                  {errors.variants?.root?.message && (
                    <FieldError id="product-variants-error">
                      {errors.variants.root.message}
                    </FieldError>
                  )}
                </section>

                <Field>
                  <FieldLabel
                    id="product-size-guide-label"
                    htmlFor="product-size-guide"
                  >
                    Reusable size guide
                  </FieldLabel>
                  <Controller
                    control={control}
                    name="sizeGuideId"
                    render={({ field, fieldState }) => (
                      <Select
                        items={[
                          { label: "No size guide assigned", value: null },
                          ...compatibleGuides.map((guide) => ({
                            label: `${guide.name} · ${guide.measurementBasis} measurements · ${guide.sizeLabels.join(", ")}`,
                            value: guide.id,
                          })),
                        ]}
                        name={field.name}
                        value={field.value || null}
                        onValueChange={(value) =>
                          field.onChange(typeof value === "string" ? value : "")
                        }
                      >
                        <SelectTrigger
                          id="product-size-guide"
                          aria-labelledby="product-size-guide-label"
                          aria-describedby={
                            fieldState.error
                              ? "product-size-guide-error"
                              : undefined
                          }
                          aria-invalid={Boolean(fieldState.error)}
                          ref={field.ref}
                          onBlur={field.onBlur}
                        >
                          <SelectValue placeholder="No size guide assigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>
                            No size guide assigned
                          </SelectItem>
                          {compatibleGuides.map((guide) => (
                            <SelectItem key={guide.id} value={guide.id}>
                              {guide.name} · {guide.measurementBasis}{" "}
                              measurements · {guide.sizeLabels.join(", ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.sizeGuideId && (
                    <FieldError id="product-size-guide-error">
                      {errors.sizeGuideId.message}
                    </FieldError>
                  )}
                  {categoryId && compatibleGuides.length === 0 && (
                    <FieldDescription>
                      No matching size guide is available.{" "}
                      <Link
                        className="text-primary underline"
                        href="/admin/catalog/size-guides"
                      >
                        Create one
                      </Link>
                      .
                    </FieldDescription>
                  )}
                  {sizeGuideId &&
                    compatibleGuides.some(
                      (guide) => guide.id === sizeGuideId,
                    ) && (
                      <FieldDescription>
                        Required for published clothing and used beside the size
                        selector on product details.
                      </FieldDescription>
                    )}
                  {hasMoreSizeGuides && nextSizeGuideOffset !== null && (
                    <Button
                      className="h-auto px-2 py-1 text-sm text-primary"
                      disabled={isLoadingSizeGuides}
                      type="button"
                      variant="ghost"
                      onClick={() => void loadMoreSizeGuides()}
                    >
                      {isLoadingSizeGuides
                        ? "Loading size guides…"
                        : "Load 100 more size guides"}
                    </Button>
                  )}
                  {sizeGuideLoadError && (
                    <FieldError>{sizeGuideLoadError}</FieldError>
                  )}
                </Field>

                <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm text-foreground">
                  <input
                    aria-label="Published on the storefront"
                    className="mt-0.5 accent-primary"
                    type="checkbox"
                    {...register("isPublished")}
                  />
                  <span>
                    <span className="block font-medium">
                      Published on the storefront
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      Only complete products with matching variants and a size
                      guide can be published.
                    </span>
                  </span>
                </label>

                {formErrorMessage && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {formErrorMessage}
                    {errorCode === "RECENT_SIGN_IN_REQUIRED" && (
                      <Link className="ml-1 underline" href="/account">
                        Go to your account
                      </Link>
                    )}
                  </p>
                )}
                <Button
                  className="h-auto w-full px-4 py-3 text-base font-semibold"
                  disabled={
                    isSubmitting || (Boolean(editingId) && !hasProductChanges)
                  }
                  type="submit"
                >
                  {isSubmitting
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : isPublished
                        ? "Create and publish"
                        : "Create draft"}
                </Button>
              </form>
            </Card>
          )}

          {view === "edit" && initialProduct && (
            <div className="mt-6">
              <CatalogMediaManager
                productId={initialProduct.id}
                variants={initialProduct.variants}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

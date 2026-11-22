"use client";

import {
  CATALOG_PRODUCT_SLUG_MAX_LENGTH,
  CatalogProductSlugSuggestionSchema,
  CatalogProductPageSchema,
  CatalogProductSchema,
  CatalogManagedProductDetailSchema,
  CatalogSizeGuidePageSchema,
  CatalogComboManageSchema,
  CatalogComboCandidatesSchema,
  type CatalogComboConfigurationInput,
  type CatalogCategory,
  type CatalogComboCandidate,
  type CatalogManagedProductDetail,
  type CatalogProductListQuery,
  type CatalogProductPage,
  MAX_COMBO_COMPONENTS,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCatalogProduct,
  configureCatalogCombo,
  fetchComboComponentCandidates,
  fetchManagedProductDetail,
  fetchManagedSizeGuides,
  fetchManagedProducts,
  suggestCatalogProductSlug,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";
const comboSelectionModeLabels = {
  fixed_combo: "Fixed combo",
  mix_colors_one_size: "Mix colors, one size",
  mix_sizes_and_colors: "Mix sizes and colors",
} as const;

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
  categoryOptions?: CatalogCategory[];
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
    getValues,
    getFieldState,
    setError,
    setValue,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProductForm, unknown, ProductSubmission>({
    resolver: zodResolver(productFormSchema),
    defaultValues: initialProduct
      ? toProductFormState(initialProduct)
      : blankProductForm,
  });
  const productNameField = register("name");
  const productSlugField = register("slug");
  const {
    fields: variantFields,
    append: appendVariant,
    remove: removeVariant,
  } = useFieldArray({ control, name: "variants" });
  const {
    fields: comboComponentFields,
    append: appendComboComponent,
    remove: removeComboComponent,
    replace: replaceComboComponents,
  } = useFieldArray({ control, name: "comboComponents" });
  const comboComponentValues = useWatch({
    control,
    name: "comboComponents",
  });
  const [
    editingId,
    categoryId,
    fit,
    sizeGuideId,
    isPublished,
    productType,
    comboSelectionMode,
  ] = useWatch({
    control,
    name: [
      "id",
      "categoryId",
      "fit",
      "sizeGuideId",
      "isPublished",
      "productType",
      "comboSelectionMode",
    ],
  });
  const hasProductChanges = hasDirtyFieldsExcept(dirtyFields, ["id"]);
  const hasProductDetailsChanges = hasDirtyFieldsExcept(dirtyFields, [
    "id",
    "comboSelectionMode",
    "comboPriceBdt",
    "comboItemCount",
    "comboComponents",
  ]);
  const comboConfigurationChanged = Boolean(
    dirtyFields.comboSelectionMode ||
    dirtyFields.comboPriceBdt ||
    dirtyFields.comboItemCount ||
    dirtyFields.comboComponents,
  );
  const slugError = errors.slug?.message;
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const comboItemCountIsLocked = Boolean(initialProduct?.combo);
  const fixedComboCountMismatch = Boolean(
    comboItemCountIsLocked &&
    comboComponentFields.length !== initialProduct?.combo?.itemCount,
  );
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const [recoveryProductId, setRecoveryProductId] = useState<string | null>(
    null,
  );
  const [lastSavedProductInput, setLastSavedProductInput] = useState<
    string | null
  >(null);
  const [productRevisionConflict, setProductRevisionConflict] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [productRefreshError, setProductRefreshError] = useState<string | null>(
    null,
  );
  const productLoadRequestId = useRef(0);
  const slugSuggestionRequestId = useRef(0);
  const [isLoadingSizeGuides, setIsLoadingSizeGuides] = useState(false);
  const [sizeGuideLoadError, setSizeGuideLoadError] = useState<string | null>(
    null,
  );
  const [comboCandidates, setComboCandidates] = useState<
    CatalogComboCandidate[]
  >(
    () =>
      initialProduct?.combo?.components.map((component) => ({
        id: component.productId,
        name: component.productName,
        variants: component.variants.map((variant) => ({
          id: variant.variantId,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          price: variant.price,
        })),
      })) ?? [],
  );
  const [comboCandidateSearch, setComboCandidateSearch] = useState("");
  const [comboCandidateError, setComboCandidateError] = useState<string | null>(
    null,
  );
  const [loadingComboCandidates, setLoadingComboCandidates] = useState(false);
  const matchingComboCandidates = comboCandidates.filter((candidate) =>
    candidate.name
      .toLocaleLowerCase()
      .includes(comboCandidateSearch.trim().toLocaleLowerCase()),
  );
  const chosenComboProductIds = new Set(
    comboComponentValues.map(({ productId }) => productId).filter(Boolean),
  );
  const availableComboCandidateCount = matchingComboCandidates.filter(
    ({ id }) => !chosenComboProductIds.has(id),
  ).length;

  useEffect(() => {
    if (view === "list" || productType !== "combo") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingComboCandidates(true);
      setComboCandidateError(null);
      void fetchComboComponentCandidates(
        comboCandidateSearch,
        controller.signal,
      )
        .then(async (response) => {
          if (!response.ok)
            throw new Error("Existing products could not be loaded.");
          const parsed = CatalogComboCandidatesSchema.safeParse(
            await response.json(),
          );
          if (!parsed.success)
            throw new Error("The existing product list was invalid.");
          if (controller.signal.aborted) return;
          setComboCandidates((current) => {
            const candidates = new Map(
              current.map((candidate) => [candidate.id, candidate]),
            );
            for (const candidate of parsed.data)
              candidates.set(candidate.id, candidate);
            return [...candidates.values()];
          });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setComboCandidateError(
              reason instanceof Error
                ? reason.message
                : "Existing products could not be loaded.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingComboCandidates(false);
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [comboCandidateSearch, productType, view]);

  async function suggestProductSlug(name: string) {
    const normalizedName = name.trim();
    if (editingId || getFieldState("slug").isDirty || !normalizedName) return;

    const requestId = ++slugSuggestionRequestId.current;
    try {
      const response = await suggestCatalogProductSlug(normalizedName);
      if (!response.ok) return;
      const result = CatalogProductSlugSuggestionSchema.safeParse(
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
    const shouldSaveComboConfiguration =
      productType === "combo" &&
      Boolean(submission.comboConfiguration) &&
      (submission.id === null ||
        comboConfigurationChanged ||
        submission.id === createdProductId ||
        submission.id === recoveryProductId);
    if (
      submission.id &&
      !hasProductChanges &&
      !shouldSaveComboConfiguration &&
      submission.id !== createdProductId
    ) {
      return;
    }
    setFormErrorMessage(null);

    try {
      let savedProductId: string;
      let savedProductDetail: CatalogManagedProductDetail;
      if (submission.id === null) {
        const input = { ...submission.input };
        if (!getFieldState("slug").isDirty) delete input.slug;
        const response = await createCatalogProduct(input);
        if (!response.ok) {
          const problem = await readApiErrorResponse(response);
          if (problem?.errorCode === "CATALOG_PRODUCT_SLUG_TAKEN") {
            setError("slug", {
              type: "server",
              message:
                getApiErrorMessage(problem) ??
                "That product slug is already in use.",
            });
            return;
          }
          setFormErrorMessage(
            getApiErrorMessage(problem) ?? "The product could not be created.",
          );
          return;
        }
        const created = CatalogProductSchema.safeParse(await response.json());
        if (!created.success) {
          setFormErrorMessage(
            "The server returned an invalid product response.",
          );
          return;
        }
        savedProductId = created.data.id;
        setCreatedProductId(savedProductId);
        reset({ ...getValues(), id: savedProductId });
        const detailResponse = await fetchManagedProductDetail(savedProductId);
        if (!detailResponse.ok) {
          setFormErrorMessage(
            "The product was created, but its edit revision could not be loaded. Reload the product list to continue.",
          );
          return;
        }
        const detail = CatalogManagedProductDetailSchema.safeParse(
          await detailResponse.json(),
        );
        if (!detail.success) {
          setFormErrorMessage("The server returned invalid product details.");
          return;
        }
        savedProductDetail = detail.data;
      } else if (
        submission.id === createdProductId ||
        submission.id === recoveryProductId
      ) {
        savedProductId = submission.id;
        const recoveredProductDetail = await fetchManagedProductDetail(
          savedProductId,
        )
          .then(async (response) => {
            if (!response.ok) return null;
            const detail = CatalogManagedProductDetailSchema.safeParse(
              await response.json(),
            );
            return detail.success ? detail.data : null;
          })
          .catch(() => null);
        if (!recoveredProductDetail) {
          setFormErrorMessage(
            "The product exists, but its edit revision could not be loaded. Refresh the product page to continue.",
          );
          return;
        }
        savedProductDetail = recoveredProductDetail;
        const productInputFingerprint = JSON.stringify(submission.input);
        if (
          hasProductDetailsChanges &&
          lastSavedProductInput !== productInputFingerprint
        ) {
          const response = await updateCatalogProduct(
            savedProductId,
            savedProductDetail.editRevision,
            submission.input,
          );
          if (!response.ok) {
            const problem = await readApiErrorResponse(response);
            if (response.status === 412) setProductRevisionConflict(true);
            setFormErrorMessage(
              getApiErrorMessage(problem) ?? "The product could not be saved.",
            );
            return;
          }
          const updated = CatalogManagedProductDetailSchema.safeParse(
            await response.json(),
          );
          if (!updated.success) {
            setFormErrorMessage(
              "The server returned an invalid product response.",
            );
            return;
          }
          savedProductDetail = updated.data;
          setLastSavedProductInput(productInputFingerprint);
        }
        if (
          submission.comboConfiguration &&
          comboConfigurationMatches(
            savedProductDetail,
            submission.comboConfiguration,
          )
        ) {
          router.replace(`/admin/catalog/${savedProductId}/edit`);
          return;
        }
      } else {
        savedProductId = submission.id;
        savedProductDetail = initialProduct!;
        if (hasProductDetailsChanges) {
          const response = await updateCatalogProduct(
            submission.id,
            initialProduct?.editRevision ?? 0,
            submission.input,
          );
          if (!response.ok) {
            const problem = await readApiErrorResponse(response);
            const message = getApiErrorMessage(problem);
            if (response.status === 412) setProductRevisionConflict(true);
            if (problem?.errorCode === "CATALOG_PRODUCT_SLUG_TAKEN") {
              setError("slug", {
                type: "server",
                message: message ?? "That product slug is already in use.",
              });
              return;
            }
            setFormErrorMessage(message ?? "The product could not be saved.");
            return;
          }
          const updated = CatalogManagedProductDetailSchema.safeParse(
            await response.json(),
          );
          if (!updated.success) {
            setFormErrorMessage(
              "The server returned an invalid product response.",
            );
            return;
          }
          savedProductDetail = updated.data;
          setLastSavedProductInput(JSON.stringify(submission.input));
          setRecoveryProductId(submission.id);
        }
      }

      if (shouldSaveComboConfiguration && submission.comboConfiguration) {
        const response = await configureCatalogCombo(
          savedProductId,
          savedProductDetail.editRevision,
          submission.comboConfiguration,
        );
        if (!response.ok) {
          const problem = await readApiErrorResponse(response);
          if (response.status === 412) setProductRevisionConflict(true);
          if (submission.id !== null) setRecoveryProductId(savedProductId);
          setFormErrorMessage(
            getApiErrorMessage(problem) ??
              "The combo configuration could not be saved.",
          );
          return;
        }
        if (
          !CatalogComboManageSchema.safeParse(await response.json()).success
        ) {
          if (submission.id !== null) setRecoveryProductId(savedProductId);
          setFormErrorMessage(
            "The server returned an invalid combo configuration.",
          );
          return;
        }
      }

      router.replace(
        (submission.id === null || submission.id === createdProductId) &&
          productType === "combo"
          ? `/admin/catalog/${savedProductId}/edit`
          : "/admin/catalog",
      );
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
      ((productType === "combo" && !fit.trim()) ||
        (guide.fit ?? "").trim().toLowerCase() === fit.trim().toLowerCase()),
  );

  return (
    <>
      <div>
        <AdminPageHeader
          title={
            view === "create"
              ? "Create product"
              : view === "edit"
                ? "Edit product"
                : "Products"
          }
          description={
            view === "list"
              ? "Manage product listings and variants."
              : view === "create"
                ? "Create one product per style, then add its real color and size options."
                : view === "edit"
                  ? "Update the product details, sellable variants, and storefront visibility."
                  : undefined
          }
          backLink={
            view !== "list" && (
              <Link className={adminPageLinkClassName} href="/admin/catalog">
                Back to products
              </Link>
            )
          }
          actions={
            view === "list" && (
              <Link
                className={buttonVariants({ size: "lg" })}
                href="/admin/catalog/create"
              >
                Create product
              </Link>
            )
          }
        />

        <div className={view === "list" ? "mt-6" : "mt-8"}>
          {view === "list" && (
            <>
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
              <ProductTable
                products={products}
                categoryOptions={categoryOptions}
                query={query}
                onRefresh={() => void loadProducts()}
                isRefreshing={isRefreshing}
                page={productPage}
              />
            </>
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
                    Drafts can be incomplete. Publishing requires a description,
                    ready image, sellable variants, and a matching size guide.
                  </p>
                </div>
              </div>

              <form
                className="mt-6 space-y-4"
                noValidate
                onSubmit={handleSubmit(saveProduct)}
              >
                <Field>
                  <FieldLabel id="product-type-label" htmlFor="product-type">
                    Product type
                  </FieldLabel>
                  <Controller
                    control={control}
                    name="productType"
                    render={({ field }) => (
                      <Select
                        disabled={Boolean(editingId)}
                        items={[
                          { label: "Single product", value: "single" },
                          { label: "Combo", value: "combo" },
                        ]}
                        value={field.value}
                        onValueChange={(value) =>
                          field.onChange(value === "combo" ? "combo" : "single")
                        }
                      >
                        <SelectTrigger
                          id="product-type"
                          aria-labelledby="product-type-label"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">Single product</SelectItem>
                          <SelectItem value="combo">Combo</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>
                    {editingId
                      ? "Product type is fixed after creation."
                      : "A combo uses inventory from the selected existing products."}
                  </FieldDescription>
                </Field>

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
                    {...productNameField}
                    onBlur={(event) => {
                      void productNameField.onBlur(event);
                      void suggestProductSlug(event.currentTarget.value);
                    }}
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
                    maxLength={CATALOG_PRODUCT_SLUG_MAX_LENGTH}
                    {...productSlugField}
                    onChange={(event) => {
                      slugSuggestionRequestId.current += 1;
                      void productSlugField.onChange(event);
                    }}
                  />
                  {slugError && (
                    <FieldError id="slug-error">{slugError}</FieldError>
                  )}
                  <FieldDescription id="product-slug-description">
                    Suggested from the name. Edit it if needed.
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

                {productType === "combo" && (
                  <section
                    aria-labelledby="combo-configuration-heading"
                    className="space-y-4 rounded-xl border border-border p-4"
                  >
                    <div>
                      <h3
                        className="font-semibold"
                        id="combo-configuration-heading"
                      >
                        Combo configuration
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Choose existing single products that supply the combo.
                        The selected products’ real variants provide the
                        available colors, sizes, and stock.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel
                          id="combo-selection-mode-label"
                          htmlFor="combo-selection-mode"
                        >
                          Customer selections
                        </FieldLabel>
                        <Controller
                          control={control}
                          name="comboSelectionMode"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onValueChange={(value) => {
                                const nextMode = value as typeof field.value;
                                if (
                                  field.value === "fixed_combo" &&
                                  nextMode !== "fixed_combo"
                                ) {
                                  const currentComponents =
                                    getValues("comboComponents");
                                  setValue(
                                    "comboItemCount",
                                    String(
                                      Math.max(2, currentComponents.length),
                                    ),
                                    { shouldDirty: true },
                                  );
                                  const uniqueComponents = [
                                    ...new Map(
                                      currentComponents.map((component) => [
                                        component.productId,
                                        component,
                                      ]),
                                    ).values(),
                                  ];
                                  if (
                                    uniqueComponents.length !==
                                    currentComponents.length
                                  ) {
                                    replaceComboComponents(
                                      uniqueComponents.map((component) => ({
                                        ...component,
                                        fixedColor: "",
                                      })),
                                    );
                                  }
                                }
                                field.onChange(nextMode);
                              }}
                            >
                              <SelectTrigger
                                id="combo-selection-mode"
                                aria-labelledby="combo-selection-mode-label"
                              >
                                <SelectValue>
                                  {comboSelectionModeLabels[comboSelectionMode]}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  disabled={
                                    fixedComboCountMismatch &&
                                    comboSelectionMode !== "fixed_combo"
                                  }
                                  value="fixed_combo"
                                >
                                  Fixed combo
                                </SelectItem>
                                <SelectItem value="mix_colors_one_size">
                                  Mix colors, one size
                                </SelectItem>
                                <SelectItem value="mix_sizes_and_colors">
                                  Mix sizes and colors
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                        <FieldDescription>
                          {comboSelectionMode === "fixed_combo"
                            ? "Every listed item is included. Fix each color; customers choose one shared size. You can add the same product more than once."
                            : comboSelectionMode === "mix_colors_one_size"
                              ? "Customers choose exactly the set size from the listed products; the same product can be picked more than once if stock allows."
                              : "Customers choose exactly the set size across any listed products, colors, and sizes. Their choices stay selected while they switch sizes."}
                        </FieldDescription>
                        {fixedComboCountMismatch && (
                          <FieldDescription>
                            A fixed combo must list exactly{" "}
                            {initialProduct?.combo?.itemCount} items. Add or
                            remove an item before changing to Fixed combo.
                          </FieldDescription>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="combo-item-count">
                          Items in combo
                        </FieldLabel>
                        <Controller
                          control={control}
                          name="comboItemCount"
                          render={({ field }) => (
                            <Input
                              id="combo-item-count"
                              inputMode="numeric"
                              max={MAX_COMBO_COMPONENTS}
                              min={2}
                              type="number"
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              onChange={field.onChange}
                              value={
                                comboSelectionMode === "fixed_combo"
                                  ? comboComponentFields.length
                                  : (field.value ?? "")
                              }
                              disabled={
                                comboItemCountIsLocked ||
                                comboSelectionMode === "fixed_combo"
                              }
                              aria-invalid={Boolean(errors.comboItemCount)}
                              aria-describedby={
                                errors.comboItemCount
                                  ? "combo-item-count-error"
                                  : "combo-item-count-description"
                              }
                            />
                          )}
                        />
                        {errors.comboItemCount && (
                          <FieldError id="combo-item-count-error">
                            {errors.comboItemCount.message}
                          </FieldError>
                        )}
                        <FieldDescription id="combo-item-count-description">
                          {comboItemCountIsLocked
                            ? "The item count is fixed after the combo is created."
                            : comboSelectionMode === "fixed_combo"
                              ? "The count follows the number of products in this fixed set."
                              : "Customers must choose exactly this many items from the products below. A product may be chosen more than once, subject to stock."}
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="combo-price">
                          Combo price (BDT)
                        </FieldLabel>
                        <Input
                          id="combo-price"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="2999"
                          aria-invalid={Boolean(errors.comboPriceBdt)}
                          aria-describedby={
                            errors.comboPriceBdt
                              ? "combo-price-error"
                              : undefined
                          }
                          {...register("comboPriceBdt")}
                        />
                        {errors.comboPriceBdt && (
                          <FieldError id="combo-price-error">
                            {errors.comboPriceBdt.message}
                          </FieldError>
                        )}
                      </Field>
                    </div>

                    <Field>
                      <FieldLabel htmlFor="combo-product-search">
                        Search products to add
                      </FieldLabel>
                      <Input
                        id="combo-product-search"
                        value={comboCandidateSearch}
                        onChange={(event) =>
                          setComboCandidateSearch(event.currentTarget.value)
                        }
                        placeholder="Search by product name"
                      />
                      {loadingComboCandidates && (
                        <FieldDescription>
                          Loading existing products…
                        </FieldDescription>
                      )}
                      {comboCandidateError && (
                        <FieldError>{comboCandidateError}</FieldError>
                      )}
                    </Field>

                    {!comboCandidateSearch.trim() && (
                      <p className="text-sm text-muted-foreground">
                        Search for a product, then add it to the combo’s product
                        list.
                      </p>
                    )}

                    {comboCandidateSearch.trim() &&
                      matchingComboCandidates.length > 0 && (
                        <div
                          aria-label="Matching products"
                          className="space-y-2"
                          role="list"
                        >
                          {matchingComboCandidates.map((candidate) => {
                            const isSelected = chosenComboProductIds.has(
                              candidate.id,
                            );
                            const canAdd =
                              (comboSelectionMode === "fixed_combo" ||
                                !isSelected) &&
                              comboComponentFields.length <
                                MAX_COMBO_COMPONENTS;
                            return (
                              <div
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                                key={candidate.id}
                                role="listitem"
                              >
                                <div>
                                  <p className="font-medium">
                                    {candidate.name}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    {describeComboCandidate(candidate)}
                                  </p>
                                </div>
                                <Button
                                  aria-label={
                                    comboSelectionMode === "fixed_combo" &&
                                    isSelected
                                      ? `Add another ${candidate.name} to combo`
                                      : `Add ${candidate.name} to combo`
                                  }
                                  disabled={!canAdd}
                                  onClick={() =>
                                    appendComboComponent({
                                      productId: candidate.id,
                                      fixedColor: "",
                                    })
                                  }
                                  type="button"
                                  variant={isSelected ? "outline" : "secondary"}
                                >
                                  {isSelected &&
                                  comboSelectionMode !== "fixed_combo"
                                    ? "Added"
                                    : isSelected
                                      ? "Add another item"
                                      : "Add item"}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    <div
                      aria-label="Combo items"
                      className="space-y-3"
                      role="group"
                    >
                      <h4 className="text-sm font-semibold">
                        {comboSelectionMode === "fixed_combo"
                          ? "Products in this combo"
                          : "Products customers can choose from"}
                      </h4>
                      {comboComponentFields.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No items added yet.
                        </p>
                      )}
                      {comboComponentFields.map((component, index) => {
                        const selectedProductId =
                          comboComponentValues[index]?.productId ?? "";
                        const candidate = comboCandidates.find(
                          ({ id }) => id === selectedProductId,
                        );
                        const colors = [
                          ...new Set(
                            candidate?.variants.map(({ color }) => color) ?? [],
                          ),
                        ];
                        const productError =
                          errors.comboComponents?.[index]?.productId?.message;
                        const fixedColorError =
                          errors.comboComponents?.[index]?.fixedColor?.message;
                        return (
                          <div
                            className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                            key={component.id}
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-muted-foreground">
                                Product {index + 1}
                              </p>
                              <p className="font-medium">
                                {candidate?.name ??
                                  "Selected product unavailable"}
                              </p>
                              {candidate && (
                                <p className="text-sm text-muted-foreground">
                                  {describeComboCandidate(candidate)}
                                </p>
                              )}
                              {productError && (
                                <FieldError>{productError}</FieldError>
                              )}
                            </div>
                            {comboSelectionMode === "fixed_combo" ? (
                              <Field>
                                <FieldLabel
                                  id={`combo-component-${index}-color-label`}
                                  htmlFor={`combo-component-${index}-color`}
                                >
                                  Fixed color
                                </FieldLabel>
                                <Controller
                                  control={control}
                                  name={
                                    `comboComponents.${index}.fixedColor` as const
                                  }
                                  render={({ field }) => (
                                    <Select
                                      value={field.value || null}
                                      onValueChange={(value) =>
                                        field.onChange(
                                          typeof value === "string"
                                            ? value
                                            : "",
                                        )
                                      }
                                    >
                                      <SelectTrigger
                                        id={`combo-component-${index}-color`}
                                        aria-labelledby={`combo-component-${index}-color-label`}
                                        aria-invalid={Boolean(fixedColorError)}
                                        aria-describedby={
                                          fixedColorError
                                            ? `combo-component-${index}-color-error`
                                            : undefined
                                        }
                                        disabled={!candidate}
                                      >
                                        <SelectValue placeholder="Choose color" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {colors.map((color) => (
                                          <SelectItem key={color} value={color}>
                                            {color}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                                {fixedColorError && (
                                  <FieldError
                                    id={`combo-component-${index}-color-error`}
                                  >
                                    {fixedColorError}
                                  </FieldError>
                                )}
                              </Field>
                            ) : (
                              <p className="self-center text-sm text-muted-foreground">
                                Customers can choose this product’s available
                                variants.
                              </p>
                            )}
                            <Button
                              aria-label={`Remove combo item ${index + 1}`}
                              className="self-end"
                              onClick={() => removeComboComponent(index)}
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        );
                      })}
                      {errors.comboComponents?.root?.message && (
                        <FieldError>
                          {errors.comboComponents.root.message}
                        </FieldError>
                      )}
                      {comboCandidateSearch.trim() &&
                        matchingComboCandidates.length === 0 &&
                        !loadingComboCandidates &&
                        !comboCandidateError && (
                          <p
                            className="text-sm text-muted-foreground"
                            role="status"
                          >
                            No products match this search.
                          </p>
                        )}
                      {comboSelectionMode !== "fixed_combo" &&
                        matchingComboCandidates.length > 0 &&
                        availableComboCandidateCount === 0 && (
                          <p
                            className="text-sm text-muted-foreground"
                            role="status"
                          >
                            All matching products are already in this combo.
                          </p>
                        )}
                    </div>
                  </section>
                )}

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
                        categories={categoryOptions}
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

                {productType === "single" && (
                  <>
                    <section
                      aria-labelledby="product-variants-heading"
                      aria-describedby={
                        errors.variants?.root
                          ? "product-variants-error"
                          : undefined
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
                            Each row is a sellable color and size. Use a unique
                            SKU; prices are whole BDT (0 for free items).
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
                              compareAtPriceBdt: "",
                            })
                          }
                        >
                          Add variant
                        </Button>
                      </div>
                      {variantFields.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No variants added. Add them before publishing.
                        </p>
                      )}
                      {variantFields.length > 0 && (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead scope="col">SKU</TableHead>
                                <TableHead scope="col">Color</TableHead>
                                <TableHead scope="col">Size</TableHead>
                                <TableHead scope="col">
                                  Selling price (BDT)
                                </TableHead>
                                <TableHead scope="col">
                                  Regular price (BDT)
                                </TableHead>
                                <TableHead className="text-right" scope="col">
                                  Actions
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {variantFields.map((variant, index) => (
                                <TableRow
                                  aria-label={`Variant ${index + 1}`}
                                  key={variant.id}
                                >
                                  <TableCell className="align-top">
                                    <label
                                      className="sr-only"
                                      htmlFor={`variant-${index}-sku`}
                                    >
                                      SKU
                                    </label>
                                    <Input
                                      id={`variant-${index}-sku`}
                                      aria-describedby={
                                        errors.variants?.[index]?.sku
                                          ? `variant-${index}-sku-error`
                                          : undefined
                                      }
                                      aria-invalid={Boolean(
                                        errors.variants?.[index]?.sku,
                                      )}
                                      maxLength={100}
                                      required
                                      {...register(
                                        `variants.${index}.sku` as const,
                                      )}
                                    />
                                    {errors.variants?.[index]?.sku && (
                                      <FieldError
                                        id={`variant-${index}-sku-error`}
                                      >
                                        {errors.variants[index].sku.message}
                                      </FieldError>
                                    )}
                                  </TableCell>
                                  <TableCell className="align-top">
                                    <label
                                      className="sr-only"
                                      htmlFor={`variant-${index}-color`}
                                    >
                                      Color
                                    </label>
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
                                      maxLength={80}
                                      required
                                      {...register(
                                        `variants.${index}.color` as const,
                                      )}
                                    />
                                    {errors.variants?.[index]?.color && (
                                      <FieldError
                                        id={`variant-${index}-color-error`}
                                      >
                                        {errors.variants[index].color.message}
                                      </FieldError>
                                    )}
                                  </TableCell>
                                  <TableCell className="align-top">
                                    <label
                                      className="sr-only"
                                      htmlFor={`variant-${index}-size`}
                                    >
                                      Size
                                    </label>
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
                                      maxLength={40}
                                      required
                                      {...register(
                                        `variants.${index}.sizeLabel` as const,
                                      )}
                                    />
                                    {errors.variants?.[index]?.sizeLabel && (
                                      <FieldError
                                        id={`variant-${index}-size-error`}
                                      >
                                        {
                                          errors.variants[index].sizeLabel
                                            .message
                                        }
                                      </FieldError>
                                    )}
                                  </TableCell>
                                  <TableCell className="align-top">
                                    <label
                                      className="sr-only"
                                      htmlFor={`variant-${index}-price`}
                                    >
                                      Selling price (BDT)
                                    </label>
                                    <Input
                                      id={`variant-${index}-price`}
                                      aria-describedby={
                                        errors.variants?.[index]?.priceBdt
                                          ? `variant-${index}-price-error product-variant-price-help`
                                          : "product-variant-price-help"
                                      }
                                      aria-invalid={Boolean(
                                        errors.variants?.[index]?.priceBdt,
                                      )}
                                      inputMode="numeric"
                                      maxLength={10}
                                      placeholder="1999"
                                      {...register(
                                        `variants.${index}.priceBdt` as const,
                                      )}
                                    />
                                    {errors.variants?.[index]?.priceBdt && (
                                      <FieldError
                                        id={`variant-${index}-price-error`}
                                      >
                                        {
                                          errors.variants[index].priceBdt
                                            .message
                                        }
                                      </FieldError>
                                    )}
                                  </TableCell>
                                  <TableCell className="align-top">
                                    <label
                                      className="sr-only"
                                      htmlFor={`variant-${index}-compare-at-price`}
                                    >
                                      Regular price (BDT, optional)
                                    </label>
                                    <Input
                                      id={`variant-${index}-compare-at-price`}
                                      aria-describedby={
                                        errors.variants?.[index]
                                          ?.compareAtPriceBdt
                                          ? `variant-${index}-compare-at-price-error product-variant-price-help`
                                          : "product-variant-price-help"
                                      }
                                      aria-invalid={Boolean(
                                        errors.variants?.[index]
                                          ?.compareAtPriceBdt,
                                      )}
                                      inputMode="numeric"
                                      maxLength={10}
                                      placeholder="Optional"
                                      {...register(
                                        `variants.${index}.compareAtPriceBdt` as const,
                                      )}
                                    />
                                    {errors.variants?.[index]
                                      ?.compareAtPriceBdt && (
                                      <FieldError
                                        id={`variant-${index}-compare-at-price-error`}
                                      >
                                        {
                                          errors.variants[index]
                                            .compareAtPriceBdt.message
                                        }
                                      </FieldError>
                                    )}
                                  </TableCell>
                                  <TableCell className="align-top text-right">
                                    <Button
                                      aria-label={`Remove variant ${index + 1}`}
                                      title={`Remove variant ${index + 1}`}
                                      className="text-muted-foreground hover:text-destructive"
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => removeVariant(index)}
                                    >
                                      <Trash2 aria-hidden="true" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {variantFields.length > 0 && (
                        <FieldDescription id="product-variant-price-help">
                          Selling price is charged. Regular price is optional
                          and must be higher to display a discount. Use whole
                          BDT amounts.
                        </FieldDescription>
                      )}
                      {errors.variants?.root?.message && (
                        <FieldError id="product-variants-error">
                          {errors.variants.root.message}
                        </FieldError>
                      )}
                    </section>
                  </>
                )}

                <Field>
                  <FieldLabel
                    id="product-size-guide-label"
                    htmlFor="product-size-guide"
                  >
                    {productType === "combo"
                      ? "Combo size guide (optional)"
                      : "Reusable size guide"}
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
                        {productType === "combo"
                          ? "Shown beside the combo’s size options. Choose a chart that matches the items in this combo."
                          : "Required for published clothing and shown beside the size selector."}
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

                {editingId ? (
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
                        {productType === "combo"
                          ? "Add a description and ready image, then configure the combo before publishing."
                          : "Add a description, ready image, sellable variants, and a matching size guide before publishing."}
                      </span>
                    </span>
                  </label>
                ) : (
                  <FieldDescription>
                    {productType === "combo"
                      ? "New combos start as drafts. After saving, add a ready image, then publish from the edit screen."
                      : "New products start as drafts. After saving, add at least one ready image, then publish from the edit screen."}
                  </FieldDescription>
                )}

                {formErrorMessage && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {formErrorMessage}
                  </p>
                )}
                {productRevisionConflict && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Reload the latest product? Unsaved changes will be lost.",
                        )
                      ) {
                        window.location.reload();
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    Reload latest product
                  </Button>
                )}
                <Button
                  className="h-auto w-full px-4 py-3 text-base font-semibold"
                  disabled={
                    isSubmitting ||
                    (Boolean(editingId) &&
                      !hasProductChanges &&
                      !(productType === "combo" && comboConfigurationChanged) &&
                      createdProductId !== editingId)
                  }
                  type="submit"
                >
                  {isSubmitting
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : productType === "combo"
                        ? "Create combo draft"
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
    </>
  );
}

function describeComboCandidate(candidate: CatalogComboCandidate): string {
  const colorCount = new Set(
    candidate.variants.map(({ color }) => color.trim().toLocaleLowerCase()),
  ).size;
  const sizeCount = new Set(
    candidate.variants.map(({ sizeLabel }) =>
      sizeLabel.trim().toLocaleLowerCase(),
    ),
  ).size;
  const variantCount = candidate.variants.length;
  return `${colorCount} ${colorCount === 1 ? "color" : "colors"} · ${sizeCount} ${sizeCount === 1 ? "size" : "sizes"} · ${variantCount} ${variantCount === 1 ? "variant" : "variants"}`;
}

function comboConfigurationMatches(
  detail: CatalogManagedProductDetail,
  configuration: CatalogComboConfigurationInput,
): boolean {
  const combo = detail.combo;
  return Boolean(
    combo &&
    combo.selectionMode === configuration.selectionMode &&
    combo.itemCount === configuration.itemCount &&
    combo.price.amountBdt === configuration.price.amountBdt &&
    combo.components.length === configuration.components.length &&
    combo.components.every((component, index) => {
      const expected = configuration.components[index];
      return (
        expected !== undefined &&
        component.productId === expected.productId &&
        component.fixedColor === expected.fixedColor
      );
    }),
  );
}

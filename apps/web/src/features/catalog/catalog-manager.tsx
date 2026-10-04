"use client";

import {
  CatalogManagedProductDetailSchema,
  CatalogProductPageSchema,
  CatalogProductSchema,
  CatalogSizeGuidePageSchema,
  type CatalogProduct,
  type CatalogManagedProductDetail,
  type CatalogProductListQuery,
  type CatalogProductPage,
  type CatalogSizeGuideSummary,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCatalogProduct,
  fetchManagedSizeGuides,
  fetchManagedProduct,
  fetchManagedProducts,
  updateCatalogProduct,
} from "@/features/catalog/catalog-client";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import Link from "next/link";
import { useCallback, useState, type SubmitEvent } from "react";

type SizeGuideOption = CatalogSizeGuideSummary;
type Audience = "" | "men" | "women" | "unisex";
type VariantDraft = {
  sku: string;
  color: string;
  sizeLabel: string;
  gtin: string;
};

interface ProductForm {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  audience: Audience;
  category: string;
  fit: string;
  fabricComposition: string;
  careInstructions: string;
  sizeGuideId: string;
  variants: VariantDraft[];
  isPublished: boolean;
  reason: string;
}

interface ApiProblem {
  code?: string;
  message?: string;
}

const blankForm: ProductForm = {
  id: null,
  slug: "",
  name: "",
  description: "",
  audience: "",
  category: "",
  fit: "",
  fabricComposition: "",
  careInstructions: "",
  sizeGuideId: "",
  variants: [],
  isPublished: false,
  reason: "",
};

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";
export function CatalogManager({
  initialPage,
  initialSizeGuides,
  initialSizeGuidesHasMore,
  initialSizeGuidesNextOffset,
  query,
}: {
  initialPage: CatalogProductPage;
  initialSizeGuides: SizeGuideOption[];
  initialSizeGuidesHasMore: boolean;
  initialSizeGuidesNextOffset: number | null;
  query: CatalogProductListQuery;
}) {
  const [products, setProducts] = useState(initialPage.products);
  const [sizeGuides, setSizeGuides] = useState(initialSizeGuides);
  const [hasMoreSizeGuides, setHasMoreSizeGuides] = useState(
    initialSizeGuidesHasMore,
  );
  const [nextSizeGuideOffset, setNextSizeGuideOffset] = useState(
    initialSizeGuidesNextOffset,
  );
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [form, setForm] = useState<ProductForm>(blankForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingSizeGuides, setIsLoadingSizeGuides] = useState(false);
  const [sizeGuideLoadError, setSizeGuideLoadError] = useState<string | null>(
    null,
  );

  const loadProducts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetchManagedProducts(query);
      if (response.status === 401) {
        setErrorMessage("Your session expired. Sign in again to continue.");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("Your account does not have catalog permissions.");
        return;
      }
      if (!response.ok) throw new Error("Catalog request failed.");

      const result = CatalogProductPageSchema.safeParse(await response.json());
      if (!result.success) throw new Error("Catalog response was invalid.");

      setProducts(result.data.products);
      setHasMore(result.data.hasMore);
      setNextOffset(result.data.nextOffset);
      setErrorMessage(null);
    } catch {
      setErrorMessage("Catalog management is temporarily unavailable.");
    } finally {
      setIsRefreshing(false);
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
      if (response.status === 401 || response.status === 403) {
        setSizeGuideLoadError(
          "Your session no longer has permission to load size guides.",
        );
        return;
      }
      if (!response.ok) throw new Error("Size guide request failed.");

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

  function updateForm<K extends keyof ProductForm>(
    key: K,
    value: ProductForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "slug") setSlugError(null);
  }

  function updateVariant<K extends keyof VariantDraft>(
    index: number,
    key: K,
    value: VariantDraft[K],
  ) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [key]: value } : variant,
      ),
    }));
  }

  async function editProduct(product: CatalogProduct) {
    setIsLoadingProduct(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetchManagedProduct(product.id);
      if (response.status === 401) {
        setErrorMessage("Your session expired. Sign in again to continue.");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("Your account does not have catalog permissions.");
        return;
      }
      if (!response.ok) throw new Error("Product details could not be loaded.");
      const result = CatalogManagedProductDetailSchema.safeParse(
        await response.json(),
      );
      if (!result.success) throw new Error("The product response was invalid.");
      if (result.data.sizeGuide) {
        const existingGuide = toSizeGuideOption(result.data.sizeGuide);
        setSizeGuides((current) =>
          current.some(({ id }) => id === existingGuide.id)
            ? current
            : [existingGuide, ...current],
        );
      }
      setForm(toProductFormState(result.data));
      setSlugError(null);
    } catch {
      setErrorMessage("Product details are temporarily unavailable.");
    } finally {
      setIsLoadingProduct(false);
    }
  }

  function resetForm() {
    setForm({ ...blankForm, variants: [] });
    setErrorMessage(null);
    setSlugError(null);
    setStatusMessage(null);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSlugError(null);
    setStatusMessage(null);
    if (
      (!form.audience && (!form.id || form.isPublished)) ||
      (!form.id && !form.category.trim())
    ) {
      setErrorMessage("Choose an audience and category before saving.");
      setIsSaving(false);
      return;
    }

    const variants = form.variants
      .filter((variant) =>
        [variant.sku, variant.color, variant.sizeLabel, variant.gtin].some(
          (value) => value.trim().length > 0,
        ),
      )
      .map((variant) => ({
        sku: variant.sku.trim(),
        color: variant.color.trim(),
        sizeLabel: variant.sizeLabel.trim(),
        gtin: variant.gtin.trim() || null,
      }));
    if (
      form.isPublished &&
      (!variants.length ||
        !form.sizeGuideId ||
        !form.audience ||
        !form.category)
    ) {
      setErrorMessage(
        "Before publishing, choose an audience and category, assign a matching size guide, and add at least one complete color and size variant.",
      );
      setIsSaving(false);
      return;
    }

    const payload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      audience: form.audience || null,
      category: form.category.trim() || null,
      fit: form.fit.trim() || null,
      fabricComposition: form.fabricComposition.trim() || null,
      careInstructions: form.careInstructions.trim() || null,
      sizeGuideId: form.sizeGuideId || null,
      variants,
      isPublished: form.isPublished,
      reason: form.reason.trim(),
    };

    try {
      const response = form.id
        ? await updateCatalogProduct(form.id, payload)
        : await createCatalogProduct({
            ...payload,
            audience: form.audience as Exclude<Audience, "">,
            category: form.category.trim(),
          });

      if (!response.ok) {
        const problem = await readCatalogApiProblem(response);
        if (response.status === 401) {
          setErrorMessage("Sign in again to continue; your session expired.");
        } else if (
          response.status === 403 &&
          problem.code !== "RECENT_SIGN_IN_REQUIRED"
        ) {
          setErrorMessage("Your account does not have catalog permissions.");
        } else if (
          response.status === 409 &&
          problem.message?.includes("slug")
        ) {
          setSlugError("That slug is already in use. Choose another one.");
        } else if (problem.code === "RECENT_SIGN_IN_REQUIRED") {
          setErrorMessage(
            "Sign in again before saving: sign out, then sign back in to renew your 15-minute confirmation.",
          );
        } else {
          setErrorMessage(problem.message ?? "Could not save this product.");
        }
        return;
      }

      const result = CatalogProductSchema.safeParse(await response.json());
      if (!result.success) {
        setErrorMessage("The server returned an invalid product response.");
        return;
      }

      setStatusMessage(
        form.id
          ? "Product updated."
          : form.isPublished
            ? "Product created and published."
            : "Draft product created.",
      );
      setForm({ ...blankForm, variants: [] });
      await loadProducts();
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const compatibleGuides = sizeGuides.filter(
    (guide) =>
      form.category.trim() &&
      guide.category.trim().toLowerCase() ===
        form.category.trim().toLowerCase() &&
      (guide.fit ?? "").trim().toLowerCase() === form.fit.trim().toLowerCase(),
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ STAFF
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Catalog management
            </h1>
            <p className="mt-2 text-muted-foreground">
              Create one product per style, then add its real color and size
              options.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/staff/catalog/size-guides"
            >
              Manage size guides
            </Link>
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/"
            >
              View public catalog
            </Link>
          </div>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
          <section aria-labelledby="managed-products-heading">
            <div className="flex items-center justify-between gap-4">
              <h2
                className="text-xl font-semibold"
                id="managed-products-heading"
              >
                Products
              </h2>
              <Button
                className="h-auto px-2 py-1 text-sm text-primary"
                variant="ghost"
                disabled={isRefreshing}
                type="button"
                onClick={() => void loadProducts()}
              >
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>

            {products.length === 0 ? (
              <p className="mt-4 rounded-xl border border-border bg-card/60 p-5 text-muted-foreground">
                No products yet. Create the first draft using the form.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {products.map((product) => (
                  <li
                    className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/60 p-4"
                    key={product.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {product.name}
                      </p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        /{product.slug}
                      </p>
                      <Badge
                        className={
                          product.isPublished
                            ? "border-success/30 bg-success/10 text-success"
                            : ""
                        }
                        variant={product.isPublished ? "outline" : "secondary"}
                      >
                        {product.isPublished ? "Published" : "Draft"}
                      </Badge>
                    </div>
                    <Button
                      aria-label={`Edit ${product.name}`}
                      className="h-auto shrink-0 px-3 py-2"
                      variant="outline"
                      type="button"
                      disabled={isLoadingProduct}
                      onClick={() => void editProduct(product)}
                    >
                      {isLoadingProduct && form.id === product.id
                        ? "Loading…"
                        : "Edit"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <CatalogPagination
              label="Staff catalog"
              pathname="/staff/catalog"
              limit={query.limit}
              offset={query.offset}
              productCount={products.length}
              hasMore={hasMore}
              nextOffset={nextOffset}
            />
          </section>

          <Card
            aria-labelledby="product-form-heading"
            className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7"
            role="region"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" id="product-form-heading">
                  {form.id ? "Edit product" : "Create a product"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Drafts can be incomplete. Publishing requires sellable
                  variants and a matching size guide.
                </p>
              </div>
              {form.id && (
                <Button
                  className="h-auto px-2 py-1 text-sm text-muted-foreground"
                  variant="ghost"
                  type="button"
                  onClick={resetForm}
                >
                  New product
                </Button>
              )}
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-name"
              >
                Name
                <Input
                  autoComplete="off"
                  className={fieldClassName}
                  id="product-name"
                  maxLength={160}
                  name="name"
                  required
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                />
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-slug"
              >
                Slug
                <Input
                  autoComplete="off"
                  aria-describedby={slugError ? "slug-error" : undefined}
                  aria-invalid={Boolean(slugError)}
                  className={fieldClassName}
                  id="product-slug"
                  maxLength={120}
                  name="slug"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                  value={form.slug}
                  onChange={(event) => updateForm("slug", event.target.value)}
                />
                {slugError && (
                  <span
                    className="block text-sm text-destructive"
                    id="slug-error"
                    role="alert"
                  >
                    {slugError}
                  </span>
                )}
                <span className="block text-xs font-normal text-muted-foreground">
                  Use lowercase letters, numbers, and single hyphens.
                </span>
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-description"
              >
                Description
                <Textarea
                  className="min-h-24 resize-y bg-background px-3 py-2.5 text-base md:text-base"
                  id="product-description"
                  maxLength={5000}
                  name="description"
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="product-audience"
                >
                  Audience
                  <select
                    className={fieldClassName}
                    id="product-audience"
                    name="audience"
                    required={!form.id || form.isPublished}
                    value={form.audience}
                    onChange={(event) =>
                      updateForm("audience", event.target.value as Audience)
                    }
                  >
                    <option value="">Choose audience</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                    <option value="unisex">Unisex</option>
                  </select>
                </label>
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="product-category"
                >
                  Category
                  <Input
                    className={fieldClassName}
                    id="product-category"
                    maxLength={80}
                    required={!form.id || form.isPublished}
                    value={form.category}
                    onChange={(event) =>
                      updateForm("category", event.target.value)
                    }
                  />
                </label>
              </div>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-fit"
              >
                Fit{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, for example Regular)
                </span>
                <Input
                  className={fieldClassName}
                  id="product-fit"
                  maxLength={80}
                  value={form.fit}
                  onChange={(event) => updateForm("fit", event.target.value)}
                />
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-fabric"
              >
                Fabric composition{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
                <Input
                  className={fieldClassName}
                  id="product-fabric"
                  maxLength={1000}
                  value={form.fabricComposition}
                  onChange={(event) =>
                    updateForm("fabricComposition", event.target.value)
                  }
                />
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-care"
              >
                Care instructions{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
                <Textarea
                  className="min-h-20 resize-y bg-background px-3 py-2.5 text-base md:text-base"
                  id="product-care"
                  maxLength={2000}
                  value={form.careInstructions}
                  onChange={(event) =>
                    updateForm("careInstructions", event.target.value)
                  }
                />
              </label>

              <section
                aria-labelledby="product-variants-heading"
                className="space-y-3 rounded-xl border border-border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold" id="product-variants-heading">
                      Color and size variants
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Each row is one sellable color and size with its own SKU.
                    </p>
                  </div>
                  <Button
                    className="h-auto px-3 py-2"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      updateForm("variants", [
                        ...form.variants,
                        { sku: "", color: "", sizeLabel: "", gtin: "" },
                      ])
                    }
                  >
                    Add variant
                  </Button>
                </div>
                {form.variants.map((variant, index) => (
                  <fieldset
                    className="grid gap-3 rounded-lg bg-background/70 p-3 sm:grid-cols-2"
                    key={index}
                  >
                    <legend className="sr-only">Variant {index + 1}</legend>
                    <label className="space-y-1 text-sm">
                      SKU
                      <Input
                        aria-label={`Variant ${index + 1} SKU`}
                        className={fieldClassName}
                        maxLength={100}
                        required
                        value={variant.sku}
                        onChange={(event) =>
                          updateVariant(index, "sku", event.target.value)
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      Color
                      <Input
                        aria-label={`Variant ${index + 1} color`}
                        className={fieldClassName}
                        maxLength={80}
                        required
                        value={variant.color}
                        onChange={(event) =>
                          updateVariant(index, "color", event.target.value)
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      Size
                      <Input
                        aria-label={`Variant ${index + 1} size`}
                        className={fieldClassName}
                        maxLength={40}
                        required
                        value={variant.sizeLabel}
                        onChange={(event) =>
                          updateVariant(index, "sizeLabel", event.target.value)
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      GTIN{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                      <Input
                        aria-label={`Variant ${index + 1} GTIN`}
                        className={fieldClassName}
                        inputMode="numeric"
                        maxLength={14}
                        value={variant.gtin}
                        onChange={(event) =>
                          updateVariant(index, "gtin", event.target.value)
                        }
                      />
                    </label>
                    <Button
                      className="h-auto justify-self-start px-2 py-1 text-sm text-destructive"
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        updateForm(
                          "variants",
                          form.variants.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                    >
                      Remove variant
                    </Button>
                  </fieldset>
                ))}
                {form.variants.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No variants added. Add them before publishing.
                  </p>
                )}
              </section>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-size-guide"
              >
                Reusable size guide
                <select
                  className={fieldClassName}
                  id="product-size-guide"
                  value={form.sizeGuideId}
                  onChange={(event) =>
                    updateForm("sizeGuideId", event.target.value)
                  }
                >
                  <option value="">No size guide assigned</option>
                  {compatibleGuides.map((guide) => (
                    <option key={guide.id} value={guide.id}>
                      {guide.name} · {guide.measurementBasis} measurements ·{" "}
                      {guide.sizeLabels.join(", ")}
                    </option>
                  ))}
                </select>
                {form.category.trim() && compatibleGuides.length === 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    No matching size guide is available.{" "}
                    <Link
                      className="text-primary underline"
                      href="/staff/catalog/size-guides"
                    >
                      Create one
                    </Link>
                    .
                  </span>
                )}
                {form.sizeGuideId &&
                  compatibleGuides.some(
                    (guide) => guide.id === form.sizeGuideId,
                  ) && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      Required for published clothing and used beside the size
                      selector on product details.
                    </span>
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
                  <span className="block text-sm text-destructive" role="alert">
                    {sizeGuideLoadError}
                  </span>
                )}
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm text-foreground">
                <input
                  aria-label="Published on the storefront"
                  className="mt-0.5 accent-primary"
                  checked={form.isPublished}
                  name="isPublished"
                  type="checkbox"
                  onChange={(event) =>
                    updateForm("isPublished", event.target.checked)
                  }
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

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="audit-reason"
              >
                Audit reason
                <Input
                  className={fieldClassName}
                  id="audit-reason"
                  maxLength={500}
                  minLength={3}
                  name="reason"
                  required
                  value={form.reason}
                  onChange={(event) => updateForm("reason", event.target.value)}
                />
              </label>

              {errorMessage && (
                <p
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {errorMessage}
                  {errorMessage.startsWith("Sign in again") && (
                    <Link className="ml-1 underline" href="/account">
                      Go to your account
                    </Link>
                  )}
                </p>
              )}
              {statusMessage && (
                <p
                  className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
                  role="status"
                >
                  {statusMessage}
                </p>
              )}

              <Button
                className="h-auto w-full px-4 py-3 text-base font-semibold"
                disabled={isSaving || isLoadingProduct}
                type="submit"
              >
                {isSaving
                  ? "Saving…"
                  : form.id
                    ? "Save changes"
                    : form.isPublished
                      ? "Create and publish"
                      : "Create draft"}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </main>
  );
}

function toProductFormState(product: CatalogManagedProductDetail): ProductForm {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? "",
    audience: product.audience ?? "",
    category: product.category ?? "",
    fit: product.fit ?? "",
    fabricComposition: product.fabricComposition ?? "",
    careInstructions: product.careInstructions ?? "",
    sizeGuideId: product.sizeGuideId ?? "",
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      gtin: variant.gtin ?? "",
    })),
    isPublished: product.isPublished,
    reason: "",
  };
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

async function readCatalogApiProblem(response: Response): Promise<ApiProblem> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return {};

    const code =
      "code" in body && typeof body.code === "string" ? body.code : undefined;
    const rawMessage = "message" in body ? body.message : undefined;
    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage
              .filter((item): item is string => typeof item === "string")
              .join(" ")
          : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

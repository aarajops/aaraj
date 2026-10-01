"use client";

import {
  CatalogProductPageSchema,
  CatalogProductSchema,
  type CatalogProduct,
  type CatalogProductListQuery,
  type CatalogProductPage,
} from "@aaraj/contracts";
import {
  createCatalogProduct,
  fetchManagedProducts,
  updateCatalogProduct,
} from "@/features/catalog/catalog-client";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import Link from "next/link";
import { useCallback, useState, type SubmitEvent } from "react";

interface ProductForm {
  id: string | null;
  slug: string;
  name: string;
  description: string;
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
  isPublished: false,
  reason: "",
};

export function CatalogManager({
  initialPage,
  query,
}: {
  initialPage: CatalogProductPage;
  query: CatalogProductListQuery;
}) {
  const [products, setProducts] = useState(initialPage.products);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [form, setForm] = useState<ProductForm>(blankForm);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  function updateForm<K extends keyof ProductForm>(
    key: K,
    value: ProductForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "slug") setSlugError(null);
  }

  function editProduct(product: CatalogProduct) {
    setForm({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description ?? "",
      isPublished: product.isPublished,
      reason: "",
    });
    setErrorMessage(null);
    setSlugError(null);
    setStatusMessage(null);
  }

  function resetForm() {
    setForm(blankForm);
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

    const payload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      isPublished: form.isPublished,
      reason: form.reason.trim(),
    };

    try {
      const response = form.id
        ? await updateCatalogProduct(form.id, payload)
        : await createCatalogProduct(payload);

      if (!response.ok) {
        const problem = await readProblem(response);
        if (response.status === 401) {
          setErrorMessage("Sign in again to continue; your session expired.");
        } else if (
          response.status === 403 &&
          problem.code !== "RECENT_SIGN_IN_REQUIRED"
        ) {
          setErrorMessage("Your account does not have catalog permissions.");
        } else if (response.status === 409) {
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
      setForm(blankForm);
      await loadProducts();
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-zinc-950 px-5 py-12 text-zinc-100 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-300">
          AARAJ STAFF
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Catalog management
            </h1>
            <p className="mt-2 text-zinc-400">
              Create product drafts and choose when they appear publicly.
            </p>
          </div>
          <Link
            className="text-sm text-emerald-300 hover:text-emerald-200"
            href="/"
          >
            View public catalog
          </Link>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
          <section aria-labelledby="managed-products-heading">
            <div className="flex items-center justify-between gap-4">
              <h2
                className="text-xl font-semibold"
                id="managed-products-heading"
              >
                Products
              </h2>
              <button
                className="text-sm text-emerald-300 hover:text-emerald-200"
                disabled={isRefreshing}
                type="button"
                onClick={() => void loadProducts()}
              >
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {products.length === 0 ? (
              <p className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-zinc-400">
                No products yet. Create the first draft using the form.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {products.map((product) => (
                  <li
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
                    key={product.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">
                        {product.name}
                      </p>
                      <p className="mt-1 truncate text-sm text-zinc-400">
                        /{product.slug}
                      </p>
                      <span
                        className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${product.isPublished ? "bg-emerald-950 text-emerald-200" : "bg-zinc-800 text-zinc-300"}`}
                      >
                        {product.isPublished ? "Published" : "Draft"}
                      </span>
                    </div>
                    <button
                      aria-label={`Edit ${product.name}`}
                      className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
                      type="button"
                      onClick={() => editProduct(product)}
                    >
                      Edit
                    </button>
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

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {form.id ? "Edit product" : "Create a product"}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  New products default to draft. You can publish now or later.
                </p>
              </div>
              {form.id && (
                <button
                  className="text-sm text-zinc-400 hover:text-white"
                  type="button"
                  onClick={resetForm}
                >
                  New product
                </button>
              )}
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-name"
              >
                Name
                <input
                  autoComplete="off"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base outline-none focus:border-emerald-400"
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
                <input
                  autoComplete="off"
                  aria-describedby={slugError ? "slug-error" : undefined}
                  aria-invalid={Boolean(slugError)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base outline-none focus:border-emerald-400"
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
                    className="block text-sm text-red-300"
                    id="slug-error"
                    role="alert"
                  >
                    {slugError}
                  </span>
                )}
                <span className="block text-xs font-normal text-zinc-500">
                  Use lowercase letters, numbers, and single hyphens.
                </span>
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="product-description"
              >
                Description
                <textarea
                  className="min-h-28 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base outline-none focus:border-emerald-400"
                  id="product-description"
                  maxLength={5000}
                  name="description"
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                />
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-zinc-800 p-3 text-sm text-zinc-200">
                <input
                  aria-label="Published on the storefront"
                  className="mt-0.5 accent-emerald-300"
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
                  <span className="mt-1 block text-zinc-400">
                    Unchecked products remain visible to authorized staff only.
                  </span>
                </span>
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="audit-reason"
              >
                Audit reason
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base outline-none focus:border-emerald-400"
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
                  className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200"
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
                  className="rounded-lg border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-200"
                  role="status"
                >
                  {statusMessage}
                </p>
              )}

              <button
                className="w-full rounded-lg bg-emerald-300 px-4 py-3 font-semibold text-zinc-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving}
                type="submit"
              >
                {isSaving
                  ? "Saving…"
                  : form.id
                    ? "Save changes"
                    : form.isPublished
                      ? "Create and publish"
                      : "Create draft"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

async function readProblem(response: Response): Promise<ApiProblem> {
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

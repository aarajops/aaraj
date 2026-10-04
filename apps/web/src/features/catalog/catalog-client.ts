import "client-only";

import type {
  CatalogCategoryCreateInput,
  CatalogCategoryUpdateInput,
  CatalogProductCreateInput,
  CatalogProductListQuery,
  CatalogProductUpdateInput,
  CatalogSizeGuideCreateInput,
  CatalogSizeGuideListQuery,
  CatalogSizeGuideUpdateInput,
} from "@aaraj/contracts";

export function fetchCatalogCategories(): Promise<Response> {
  return fetch("/api/catalog/categories", {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchManagedCatalogCategories(): Promise<Response> {
  return fetch("/api/catalog/categories/manage", {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function createCatalogCategory(
  input: CatalogCategoryCreateInput,
): Promise<Response> {
  return fetch("/api/catalog/categories", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCatalogCategory(
  categoryId: string,
  input: CatalogCategoryUpdateInput,
): Promise<Response> {
  return fetch(`/api/catalog/categories/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchManagedProducts(
  query: CatalogProductListQuery,
): Promise<Response> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return fetch(`/api/catalog/products/manage?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchManagedProduct(productId: string): Promise<Response> {
  return fetch(
    `/api/catalog/products/manage/${encodeURIComponent(productId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
}

export function fetchManagedSizeGuides(
  query: Pick<CatalogSizeGuideListQuery, "limit" | "offset">,
): Promise<Response> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return fetch(`/api/catalog/size-guides/manage?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchManagedSizeGuide(guideId: string): Promise<Response> {
  return fetch(
    `/api/catalog/size-guides/manage/${encodeURIComponent(guideId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
}

export function createCatalogProduct(
  input: CatalogProductCreateInput,
): Promise<Response> {
  return fetch("/api/catalog/products", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCatalogProduct(
  productId: string,
  input: CatalogProductUpdateInput,
): Promise<Response> {
  return fetch(`/api/catalog/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createCatalogSizeGuide(
  input: CatalogSizeGuideCreateInput,
): Promise<Response> {
  return fetch("/api/catalog/size-guides", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCatalogSizeGuide(
  guideId: string,
  input: CatalogSizeGuideUpdateInput,
): Promise<Response> {
  return fetch(`/api/catalog/size-guides/${encodeURIComponent(guideId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

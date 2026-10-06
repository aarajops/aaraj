import "client-only";

import { API_V1_BASE_PATH } from "@aaraj/contracts";
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
  return fetch(`${API_V1_BASE_PATH}/catalog/categories`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function createCatalogCategory(
  input: CatalogCategoryCreateInput,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/catalog/categories`, {
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
  return fetch(
    `${API_V1_BASE_PATH}/catalog/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function fetchManagedProducts(
  query: CatalogProductListQuery,
): Promise<Response> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.search) search.set("search", query.search);
  if (query.categoryId) search.set("categoryId", query.categoryId);
  if (query.status) search.set("status", query.status);
  return fetch(`${API_V1_BASE_PATH}/catalog/products/manage?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchManagedSizeGuides(
  query: CatalogSizeGuideListQuery,
): Promise<Response> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.search) search.set("search", query.search);
  if (query.categoryId) search.set("categoryId", query.categoryId);
  if (query.fit) search.set("fit", query.fit);
  if (query.measurementBasis) {
    search.set("measurementBasis", query.measurementBasis);
  }
  return fetch(`${API_V1_BASE_PATH}/catalog/size-guides/manage?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function createCatalogProduct(
  input: CatalogProductCreateInput,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/catalog/products`, {
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
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/${encodeURIComponent(productId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function createCatalogSizeGuide(
  input: CatalogSizeGuideCreateInput,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/catalog/size-guides`, {
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
  return fetch(
    `${API_V1_BASE_PATH}/catalog/size-guides/${encodeURIComponent(guideId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

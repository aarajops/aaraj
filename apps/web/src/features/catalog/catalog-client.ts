import "client-only";

import { API_V1_BASE_PATH } from "@aaraj/contracts";
import type {
  CatalogMediaDeleteInput,
  CatalogProductMediaOrderInput,
  CatalogMediaUploadInput,
  CatalogCategoryCreateInput,
  CatalogCategoryUpdateInput,
  CatalogProductCreateInput,
  CatalogProductListQuery,
  CatalogProductUpdateInput,
  CatalogComboConfigurationInput,
  CatalogSizeGuideCreateInput,
  CatalogSizeGuideListQuery,
  CatalogSizeGuideUpdateInput,
} from "@aaraj/contracts";

export function suggestCatalogCategorySlug(name: string): Promise<Response> {
  const search = new URLSearchParams({ name });
  return fetch(
    `${API_V1_BASE_PATH}/catalog/categories/slug-suggestion?${search}`,
    { cache: "no-store", credentials: "same-origin" },
  );
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
  editRevision: number,
  input: CatalogCategoryUpdateInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "If-Match": catalogCategoryEditEtag(categoryId, editRevision),
      },
      body: JSON.stringify(input),
    },
  );
}

function catalogCategoryEditEtag(categoryId: string, revision: number): string {
  return `"catalog-category:${categoryId}:r${revision}"`;
}

export function uploadCatalogCategoryImage(
  categoryId: string,
  file: File,
): Promise<Response> {
  const body = new FormData();
  body.set("file", file);
  return fetch(
    `${API_V1_BASE_PATH}/catalog/categories/${encodeURIComponent(categoryId)}/image`,
    {
      method: "POST",
      credentials: "same-origin",
      body,
    },
  );
}

export function fetchManagedProducts(
  query: CatalogProductListQuery,
  signal?: AbortSignal,
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
    signal,
  });
}

export function fetchManagedProductDetail(
  productId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );
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

export function suggestCatalogProductSlug(name: string): Promise<Response> {
  const search = new URLSearchParams({ name });
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/slug-suggestion?${search}`,
    { cache: "no-store", credentials: "same-origin" },
  );
}

export function updateCatalogProduct(
  productId: string,
  editRevision: number,
  input: CatalogProductUpdateInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/${encodeURIComponent(productId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "If-Match": catalogProductEditEtag(productId, editRevision),
      },
      body: JSON.stringify(input),
    },
  );
}

export function fetchComboComponentCandidates(
  search?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const query = new URLSearchParams();
  if (search?.trim()) query.set("search", search.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  return fetch(
    `${API_V1_BASE_PATH}/catalog/combos/manage/candidates${suffix}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );
}

export function configureCatalogCombo(
  productId: string,
  productRevision: number,
  input: CatalogComboConfigurationInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/combos/manage/${encodeURIComponent(productId)}`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "If-Match": catalogProductEditEtag(productId, productRevision),
      },
      body: JSON.stringify(input),
    },
  );
}

function catalogProductEditEtag(productId: string, revision: number): string {
  return `"catalog-product:${productId}:r${revision}"`;
}

export function fetchManagedProductMedia(productId: string): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
}

export function managedProductMediaPreviewUrl(
  productId: string,
  mediaId: string,
): string {
  return `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}/preview`;
}

export function reorderCatalogProductMedia(
  productId: string,
  input: CatalogProductMediaOrderInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media/order`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function uploadCatalogProductMedia(
  productId: string,
  input: CatalogMediaUploadInput,
  file: File,
): Promise<Response> {
  const body = new FormData();
  body.set("commandId", input.commandId);
  if (input.variantId) body.set("variantId", input.variantId);
  body.set("altText", input.altText);
  if (input.reason) body.set("reason", input.reason);
  body.set("file", file, file.name);

  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media`,
    {
      method: "POST",
      credentials: "same-origin",
      body,
    },
  );
}

export function retryCatalogProductMedia(
  productId: string,
  mediaId: string,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}/retry`,
    { method: "POST", credentials: "same-origin" },
  );
}

export function deleteCatalogProductMedia(
  productId: string,
  mediaId: string,
  input: CatalogMediaDeleteInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
    {
      method: "DELETE",
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
  editRevision: number,
  input: CatalogSizeGuideUpdateInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/size-guides/${encodeURIComponent(guideId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "If-Match": catalogSizeGuideEditEtag(guideId, editRevision),
      },
      body: JSON.stringify(input),
    },
  );
}

function catalogSizeGuideEditEtag(guideId: string, revision: number): string {
  return `"catalog-size-guide:${guideId}:r${revision}"`;
}

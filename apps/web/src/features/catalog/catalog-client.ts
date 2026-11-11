import "client-only";

import { API_V1_BASE_PATH } from "@aaraj/contracts";
import type {
  CatalogMediaDeleteInput,
  CatalogMediaUpdateInput,
  CatalogProductMediaOrderInput,
  CatalogMediaUploadInput,
  CatalogCategoryCreateInput,
  CatalogCategoryUpdateInput,
  CatalogProductCreateInput,
  CatalogProductListQuery,
  CatalogProductUpdateInput,
  CatalogSizeGuideCreateInput,
  CatalogSizeGuideListQuery,
  CatalogSizeGuideUpdateInput,
  CatalogVideoDeleteInput,
  CatalogVideoMetadataUpdateInput,
  CatalogVideoOrderInput,
  CatalogVideoProvisionInput,
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
  if (input.variantColor) body.set("variantColor", input.variantColor);
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

export function updateCatalogProductMedia(
  productId: string,
  mediaId: string,
  input: CatalogMediaUpdateInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function fetchManagedProductVideos(
  productId: string,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos`,
    { cache: "no-store", credentials: "same-origin" },
  );
}

export function provisionCatalogProductVideoUpload(
  productId: string,
  input: CatalogVideoProvisionInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function completeCatalogProductVideoUpload(
  productId: string,
  videoId: string,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}/complete`,
    { method: "POST", credentials: "same-origin" },
  );
}

export function syncCatalogProductVideo(
  productId: string,
  videoId: string,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}/sync`,
    { method: "POST", credentials: "same-origin" },
  );
}

export function updateCatalogProductVideo(
  productId: string,
  videoId: string,
  input: CatalogVideoMetadataUpdateInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function reorderCatalogProductVideos(
  productId: string,
  input: CatalogVideoOrderInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/order`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function uploadCatalogProductVideoCaption(
  productId: string,
  videoId: string,
  language: string,
  file: File,
): Promise<Response> {
  const body = new FormData();
  body.set("file", file, file.name);
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(language)}`,
    { method: "POST", credentials: "same-origin", body },
  );
}

export function deleteCatalogProductVideo(
  productId: string,
  videoId: string,
  input: CatalogVideoDeleteInput,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}/videos/${encodeURIComponent(videoId)}`,
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

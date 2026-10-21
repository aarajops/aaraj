import "client-only";

import {
  API_V1_BASE_PATH,
  type StorefrontBannerUpdate,
  type StorefrontBrandAssetKind,
  type StorefrontSettingsUpdate,
} from "@aaraj/contracts";

export function fetchManagedStorefrontSettings(): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/settings`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function updateManagedStorefrontSettings(
  input: StorefrontSettingsUpdate,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/settings`, {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function uploadStorefrontBrandAsset(
  kind: StorefrontBrandAssetKind,
  file: File,
  expectedVersion: number,
): Promise<Response> {
  const body = new FormData();
  body.set("commandId", crypto.randomUUID());
  body.set("expectedVersion", String(expectedVersion));
  body.set("file", file);
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/assets/${kind}`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    body,
  });
}

export function clearStorefrontBrandAsset(
  kind: StorefrontBrandAssetKind,
  expectedVersion: number,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/assets/${kind}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion }),
  });
}

export function uploadStorefrontBannerAsset(file: File): Promise<Response> {
  const body = new FormData();
  body.set("commandId", crypto.randomUUID());
  body.set("file", file);
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/banner-assets`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    body,
  });
}

export function fetchMoreStorefrontBannerAssets(
  cursor: string,
): Promise<Response> {
  const query = new URLSearchParams({ cursor });
  return fetch(`${API_V1_BASE_PATH}/storefront/manage/banner-assets?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function saveStorefrontBanner(
  bannerId: string | undefined,
  values: StorefrontBannerUpdate,
): Promise<Response> {
  const createValues = {
    name: values.name,
    placement: values.placement,
    active: values.active,
    desktopAssetId: values.desktopAssetId,
    mobileAssetId: values.mobileAssetId,
    altText: values.altText,
    href: values.href,
  };
  const path = bannerId
    ? `${API_V1_BASE_PATH}/storefront/manage/banners/${encodeURIComponent(bannerId)}`
    : `${API_V1_BASE_PATH}/storefront/manage/banners`;

  return fetch(path, {
    method: bannerId ? "PUT" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bannerId ? values : createValues),
  });
}

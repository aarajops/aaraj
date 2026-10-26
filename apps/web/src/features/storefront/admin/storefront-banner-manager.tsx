"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ApiErrorResponseSchema,
  MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH,
  MAX_STOREFRONT_BANNER_HREF_LENGTH,
  MAX_STOREFRONT_BANNER_NAME_LENGTH,
  MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
  StorefrontBannerAssetPageSchema,
  ManagedStorefrontBannerAssetSchema,
  STOREFRONT_BANNER_PLACEMENTS,
  STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
  StorefrontBannerSchema,
  StorefrontBannerUpdateSchema,
  type StorefrontBanner,
  type StorefrontBannerPlacement,
  type ManagedStorefrontBannerAsset,
  type StorefrontBannerAssetPage,
  type StorefrontBannerUpdate,
} from "@aaraj/contracts";
import { useForm, useWatch } from "react-hook-form";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/date-time";
import { getApiErrorMessage } from "@/lib/api-error";
import {
  fetchMoreStorefrontBannerAssets,
  saveStorefrontBanner,
  uploadStorefrontBannerAsset,
} from "@/features/storefront/admin/storefront-management-client";
import { revalidateStorefrontBanners } from "@/features/storefront/admin/storefront-banner-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const BANNER_LIST_PATH = "/admin/storefront/banners";

export function StorefrontBannerManager({
  bannerId,
  initialBanner = null,
  initialAssets,
}: {
  bannerId?: string;
  initialBanner?: StorefrontBanner | null;
  initialAssets: StorefrontBannerAssetPage;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets.assets);
  const [nextAssetsCursor, setNextAssetsCursor] = useState(
    initialAssets.nextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { isDirty, errors },
  } = useForm<StorefrontBannerUpdate>({
    resolver: zodResolver(StorefrontBannerUpdateSchema),
    defaultValues: initialBanner ? toValues(initialBanner) : blankValues(),
  });
  const active = useWatch({ control, name: "active" }) ?? false;
  const placement = useWatch({ control, name: "placement" });
  const desktopAssetId = useWatch({ control, name: "desktopAssetId" });
  const mobileAssetId = useWatch({ control, name: "mobileAssetId" });
  const assetOptions = [
    ...new Map(
      [
        ...assets,
        ...(initialBanner?.desktop ? [initialBanner.desktop] : []),
        ...(initialBanner?.mobile ? [initialBanner.mobile] : []),
      ].map((asset) => [asset.id, asset]),
    ).values(),
  ];
  const desktop = assetOptions.find((asset) => asset.id === desktopAssetId);
  const mobile = assetOptions.find((asset) => asset.id === mobileAssetId);

  // Server Components provide the initial authorized banner and image page.
  // Keep mutations and subsequent cursor pages in this client boundary.

  async function upload(file: File | undefined, target: "desktop" | "mobile") {
    if (!file) return;
    if (file.size < 1 || file.size > MAX_STOREFRONT_ASSET_UPLOAD_BYTES) {
      setError(
        `Choose an image no larger than ${MAX_STOREFRONT_ASSET_UPLOAD_BYTES / 1024 / 1024} MiB.`,
      );
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await uploadStorefrontBannerAsset(file);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, "The image could not be uploaded."),
        );
      }
      const result = ManagedStorefrontBannerAssetSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned an invalid banner image.");
      }
      const uploaded = result.data;
      setAssets((current) => mergeAssets(current, [uploaded]));
      setValue(
        target === "desktop" ? "desktopAssetId" : "mobileAssetId",
        uploaded.id,
        { shouldDirty: true, shouldValidate: true },
      );
      setNotice(
        `${target === "desktop" ? "Desktop" : "Mobile"} image uploaded. Save the banner to keep the change.`,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The image could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function save(values: StorefrontBannerUpdate) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await saveStorefrontBanner(bannerId, values);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseMessage(body, "Banner could not be saved."));
      }
      const result = StorefrontBannerSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned an invalid banner record.");
      }
      await revalidateStorefrontBanners();
      router.replace(BANNER_LIST_PATH);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Banner could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadMoreAssets() {
    if (!nextAssetsCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetchMoreStorefrontBannerAssets(nextAssetsCursor);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, "More banner images could not be loaded."),
        );
      }
      const result = StorefrontBannerAssetPageSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned an invalid banner image page.");
      }
      setAssets((current) => mergeAssets(current, result.data.assets));
      setNextAssetsCursor(result.data.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "More banner images could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const title = bannerId ? "Edit banner" : "Create banner";
  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="container mx-auto">
        <Link
          className="text-sm text-primary hover:text-primary/80"
          href={BANNER_LIST_PATH}
        >
          ← Back to banners
        </Link>
        <div className="mt-5">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary">
            AARAJ ADMIN
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Configure reusable artwork and publish it to the homepage hero
            carousel. Set their display order from the banner list.
          </p>
        </div>

        <section className="mt-8 grid gap-6" aria-label="Banner form">
          {error && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          {notice && (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          )}
          <form
            className="grid gap-6"
            onSubmit={(event) => void handleSubmit(save)(event)}
          >
            {STOREFRONT_BANNER_PLACEMENTS.length > 1 ? (
              <Field>
                <FieldLabel htmlFor="banner-placement">
                  Storefront location
                </FieldLabel>
                <Select
                  value={placement}
                  onValueChange={(value) =>
                    setValue("placement", value as StorefrontBannerPlacement, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  disabled={saving || uploading}
                >
                  <SelectTrigger id="banner-placement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOREFRONT_BANNER_PLACEMENTS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {formatPlacement(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <input type="hidden" {...register("placement")} />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Banner details</CardTitle>
                <CardDescription>
                  Use 2560 × 1080 px (21:9) for desktop artwork. Upload a
                  separate mobile image when needed. Images keep their aspect
                  ratio while being optimized and stored for reuse.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <Field>
                  <FieldLabel htmlFor="banner-name">Internal name</FieldLabel>
                  <Input
                    id="banner-name"
                    autoComplete="off"
                    maxLength={MAX_STOREFRONT_BANNER_NAME_LENGTH}
                    aria-invalid={Boolean(errors.name)}
                    placeholder="Summer collection"
                    {...register("name")}
                  />
                  {errors.name?.message && (
                    <FieldError>{errors.name.message}</FieldError>
                  )}
                  <FieldDescription>
                    Used to identify this banner in the admin table.
                  </FieldDescription>
                </Field>

                <Field className="flex items-start gap-3">
                  <Checkbox
                    id="banner-active"
                    checked={active}
                    onCheckedChange={(checked) =>
                      setValue("active", checked === true, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                  <span className="grid gap-1">
                    <FieldLabel htmlFor="banner-active">
                      Publish this banner
                    </FieldLabel>
                    <FieldDescription>
                      Published banners appear in the homepage hero carousel.
                      Keep only current campaigns published.
                    </FieldDescription>
                  </span>
                </Field>

                <div className="grid gap-5 md:grid-cols-2">
                  <AssetField
                    assets={assetOptions}
                    id="banner-desktop"
                    label="Desktop image"
                    target="desktop"
                    value={desktopAssetId ?? null}
                    disabled={saving || uploading}
                    error={errors.desktopAssetId?.message}
                    onSelect={(id) =>
                      setValue("desktopAssetId", id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    onFile={(file) => void upload(file, "desktop")}
                  />
                  <AssetField
                    assets={assetOptions}
                    id="banner-mobile"
                    label="Mobile image (optional)"
                    target="mobile"
                    value={mobileAssetId ?? null}
                    disabled={saving || uploading}
                    onSelect={(id) =>
                      setValue("mobileAssetId", id, { shouldDirty: true })
                    }
                    onFile={(file) => void upload(file, "mobile")}
                  />
                </div>

                <Field>
                  <FieldLabel htmlFor="banner-alt">Alternative text</FieldLabel>
                  <Textarea
                    id="banner-alt"
                    maxLength={MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH}
                    aria-invalid={Boolean(errors.altText)}
                    placeholder="Describe the banner, or leave blank if decorative."
                    {...register("altText")}
                  />
                  {errors.altText?.message && (
                    <FieldError>{errors.altText.message}</FieldError>
                  )}
                  <FieldDescription>
                    Linked banners need text that describes the link purpose.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="banner-href">Link (optional)</FieldLabel>
                  <Input
                    id="banner-href"
                    placeholder="/shop or https://example.com"
                    type="text"
                    maxLength={MAX_STOREFRONT_BANNER_HREF_LENGTH}
                    {...register("href", {
                      setValueAs: (value: unknown) =>
                        typeof value === "string" ? value.trim() || null : null,
                    })}
                  />
                  <FieldDescription>
                    Use an internal path or a secure HTTPS address.
                  </FieldDescription>
                </Field>

                {(desktop || mobile) && (
                  <div
                    className="grid gap-4 sm:grid-cols-2"
                    aria-label="Selected image previews"
                  >
                    {desktop && (
                      <BannerPreview asset={desktop} label="Desktop preview" />
                    )}
                    {mobile && (
                      <BannerPreview asset={mobile} label="Mobile preview" />
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                  <Button
                    disabled={saving || uploading || !isDirty}
                    type="submit"
                  >
                    {saving
                      ? "Saving…"
                      : bannerId
                        ? "Save changes"
                        : "Create banner"}
                  </Button>
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    href={BANNER_LIST_PATH}
                  >
                    Cancel
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {assets.length} image{assets.length === 1 ? "" : "s"} loaded
                  </p>
                  {nextAssetsCursor && (
                    <Button
                      disabled={saving || uploading || loadingMore}
                      onClick={() => void loadMoreAssets()}
                      type="button"
                      variant="outline"
                    >
                      {loadingMore ? "Loading…" : "Load more images"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </form>
        </section>
      </div>
    </main>
  );
}

function AssetField({
  assets,
  id,
  label,
  target,
  value,
  disabled,
  error,
  onSelect,
  onFile,
}: {
  assets: ManagedStorefrontBannerAsset[];
  id: string;
  label: string;
  target: "desktop" | "mobile";
  value: string | null;
  disabled: boolean;
  error?: string;
  onSelect: (id: string | null) => void;
  onFile: (file: File | undefined) => void;
}) {
  const inputId = `${id}-file`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value ?? "__none__"}
        onValueChange={(next) => onSelect(next === "__none__" ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-invalid={Boolean(error)}>
          <SelectValue placeholder="Choose an uploaded image" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No image</SelectItem>
          {assets.map((asset) => (
            <SelectItem key={asset.id} value={asset.id}>
              {formatDateTime(asset.createdAt)} · {asset.width} × {asset.height}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <FieldError>{error}</FieldError>}
      <FieldLabel htmlFor={inputId}>Upload new {target} image</FieldLabel>
      <Input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(event) => {
          onFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <FieldDescription>
        Upload a JPEG, PNG, or WebP image up to{" "}
        {MAX_STOREFRONT_ASSET_UPLOAD_BYTES / 1024 / 1024} MiB for the {target}{" "}
        layout.
      </FieldDescription>
    </Field>
  );
}

function BannerPreview({
  asset,
  label,
}: {
  asset: ManagedStorefrontBannerAsset;
  label: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <Image
        alt=""
        className="h-auto w-full"
        height={asset.height}
        src={asset.src}
        unoptimized
        width={asset.width}
      />
    </div>
  );
}

function blankValues(): StorefrontBannerUpdate {
  return {
    name: "",
    placement: STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
    active: false,
    desktopAssetId: null,
    mobileAssetId: null,
    altText: "",
    href: null,
    expectedVersion: 1,
  };
}

function toValues(banner: StorefrontBanner): StorefrontBannerUpdate {
  return {
    name: banner.name,
    placement: banner.placement,
    active: banner.active,
    desktopAssetId: banner.desktop?.id ?? null,
    mobileAssetId: banner.mobile?.id ?? null,
    altText: banner.altText,
    href: banner.href,
    expectedVersion: banner.version,
  };
}

function mergeAssets(
  current: ManagedStorefrontBannerAsset[],
  incoming: ManagedStorefrontBannerAsset[],
): ManagedStorefrontBannerAsset[] {
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of incoming) byId.set(asset.id, asset);
  return [...byId.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

const storefrontBannerPlacementLabels: Record<
  StorefrontBannerPlacement,
  string
> = {
  [STOREFRONT_BANNER_PLACEMENT_HOME_HERO]: "Homepage hero",
};

function formatPlacement(placement: StorefrontBannerPlacement): string {
  return storefrontBannerPlacementLabels[placement];
}

function responseMessage(body: unknown, fallback: string): string {
  const result = ApiErrorResponseSchema.safeParse(body);
  if (!result.success) return fallback;
  if (result.data.errorCode === "STOREFRONT_BANNER_STALE") {
    return "This banner changed in another session. Reload and apply your changes again.";
  }
  return getApiErrorMessage(body, fallback);
}

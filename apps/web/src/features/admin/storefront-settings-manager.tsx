"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  StorefrontSettingsSchema,
  type CatalogCategoryOption,
  type StorefrontBrandAssetKind,
  type StorefrontSettings,
  type StorefrontSettingsUpdate,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hasDirtyFieldsExcept } from "@/lib/form-dirty-state";
import {
  socialFields,
  storefrontSettingsFormSchema,
  toStorefrontSettingsDraft,
  type StorefrontSettingsDraft,
  type StorefrontSettingsFormValues,
} from "./storefront-settings-form";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
const assetLabels: Record<StorefrontBrandAssetKind, string> = {
  logo: "Logo",
  brandIcon: "Brand icon",
  favicon: "Favicon",
  socialImage: "Social image",
};

export function StorefrontSettingsManager({
  categoryOptions,
}: {
  categoryOptions: CatalogCategoryOption[];
}) {
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [brandIconFile, setBrandIconFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [socialImageFile, setSocialImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<StorefrontBrandAssetKind | null>(
    null,
  );
  const [clearing, setClearing] = useState<StorefrontBrandAssetKind | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<StorefrontSettingsDraft, unknown, StorefrontSettingsFormValues>({
    resolver: zodResolver(storefrontSettingsFormSchema),
    defaultValues: {
      siteName: "",
      brandColor: "",
      backgroundColor: "",
      seoTitle: "",
      seoDescription: "",
      socialImageAlt: "",
      announcementEnabled: false,
      announcementText: "",
      supportPhone: "",
      supportEmail: "",
      businessAddress: "",
      socialLinks: {
        instagram: "",
        facebook: "",
        tiktok: "",
        youtube: "",
        x: "",
      },
      footerDescription: "",
      footerLinks: [],
      headerNavigation: [],
      expectedVersion: 1,
    },
  });
  const {
    fields: footerLinkFields,
    append: appendFooterLink,
    remove: removeFooterLink,
    move: moveFooterLink,
  } = useFieldArray({ control, name: "footerLinks" });
  const {
    fields: headerNavigationFields,
    append: appendHeaderNavigationItem,
    remove: removeHeaderNavigationItem,
    move: moveHeaderNavigationItem,
    update: updateHeaderNavigationItem,
  } = useFieldArray({ control, name: "headerNavigation" });
  const footerLinks = useWatch({ control, name: "footerLinks" }) ?? [];
  const headerNavigation =
    useWatch({ control, name: "headerNavigation" }) ?? [];
  const announcementEnabled =
    useWatch({ control, name: "announcementEnabled" }) ?? false;
  const announcementText =
    useWatch({ control, name: "announcementText" }) ?? "";
  const siteName = useWatch({ control, name: "siteName" }) ?? "";
  const changed =
    settings && hasDirtyFieldsExcept(dirtyFields, ["expectedVersion"]);
  const logoInput = useRef<HTMLInputElement>(null);
  const brandIconInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);
  const socialImageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch(`${API_V1_BASE_PATH}/storefront/manage/settings`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            responseMessage(body, "Storefront settings could not be loaded."),
          );
        }
        const result = StorefrontSettingsSchema.safeParse(body);
        if (!result.success) {
          throw new Error("The server returned invalid storefront settings.");
        }
        if (active) {
          setSettings(result.data);
          reset(toStorefrontSettingsDraft(result.data));
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Storefront settings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reset]);

  async function save(input: StorefrontSettingsUpdate) {
    if (!settings || saving || !changed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `${API_V1_BASE_PATH}/storefront/manage/settings`,
        {
          method: "PUT",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, "Storefront settings could not be saved."),
        );
      }
      const result = StorefrontSettingsSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      reset(toStorefrontSettingsDraft(result.data));
      setNotice("Storefront settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Storefront settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(kind: StorefrontBrandAssetKind) {
    if (!settings || uploading || clearing) return;
    const file =
      kind === "logo"
        ? logoFile
        : kind === "brandIcon"
          ? brandIconFile
          : kind === "favicon"
            ? faviconFile
            : socialImageFile;
    if (!file) return;
    setUploading(kind);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("commandId", crypto.randomUUID());
      form.set("expectedVersion", String(settings.version));
      form.set("file", file);
      const response = await fetch(
        `${API_V1_BASE_PATH}/storefront/manage/assets/${kind}`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          body: form,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, `The ${kind} could not be uploaded.`),
        );
      }
      const result = StorefrontSettingsSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      setValue("expectedVersion", result.data.version, { shouldDirty: false });
      if (kind === "logo") {
        setLogoFile(null);
        if (logoInput.current) logoInput.current.value = "";
      } else if (kind === "brandIcon") {
        setBrandIconFile(null);
        if (brandIconInput.current) brandIconInput.current.value = "";
      } else if (kind === "favicon") {
        setFaviconFile(null);
        if (faviconInput.current) faviconInput.current.value = "";
      } else {
        setSocialImageFile(null);
        if (socialImageInput.current) socialImageInput.current.value = "";
      }
      setNotice(`${assetLabels[kind]} uploaded and published.`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : `The ${kind} could not be uploaded.`,
      );
    } finally {
      setUploading(null);
    }
  }

  async function clearAsset(kind: StorefrontBrandAssetKind) {
    if (!settings || uploading || clearing) return;
    setClearing(kind);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `${API_V1_BASE_PATH}/storefront/manage/assets/${kind}`,
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: settings.version,
          }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, `The ${kind} could not be removed.`),
        );
      }
      const result = StorefrontSettingsSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      setValue("expectedVersion", result.data.version, { shouldDirty: false });
      setNotice(`${assetLabels[kind]} removed.`);
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : `The ${kind} could not be removed.`,
      );
    } finally {
      setClearing(null);
    }
  }

  function addHeaderCategory(categoryId: string) {
    if (!categoryId || headerNavigation.length >= 8) return;
    appendHeaderNavigationItem({ type: "category", categoryId });
  }

  const configuredCategoryIds = new Set(
    headerNavigation.flatMap((item) =>
      item.type === "category" ? [item.categoryId] : [],
    ),
  );
  const availableCategories = categoryOptions.filter(
    ({ id }) => !configuredCategoryIds.has(id),
  );

  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Storefront configuration</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage the public identity, contact information, header navigation,
        social links, and storefront footer.
      </p>

      {error && (
        <p
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="mt-5 rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-6" role="status">
          Loading storefront settings…
        </p>
      ) : settings ? (
        <form
          className="mt-6 grid gap-8"
          noValidate
          onSubmit={handleSubmit(save)}
        >
          {Object.keys(errors).length > 0 && (
            <ul
              className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {collectFieldErrorMessages(errors).map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          )}
          <section
            aria-labelledby="brand-assets-heading"
            className="grid gap-5"
          >
            <div>
              <h3 className="text-lg font-semibold" id="brand-assets-heading">
                Brand assets
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload PNG, JPEG, or WebP files up to 5 MB. Images are
                normalized before publication; SVG files are not accepted.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="storefront-logo">
                  Storefront logo lockup
                </FieldLabel>
                <Input
                  ref={logoInput}
                  accept="image/png,image/jpeg,image/webp"
                  id="storefront-logo"
                  type="file"
                  onChange={(event) =>
                    setLogoFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                {settings.logo ? (
                  <Image
                    alt="Current store logo preview"
                    className="max-h-16 max-w-56 object-contain"
                    height={settings.logo.height}
                    src={settings.logo.src}
                    unoptimized
                    width={settings.logo.width}
                  />
                ) : (
                  <FieldDescription>No logo uploaded.</FieldDescription>
                )}
                <FieldDescription>
                  Wide brand artwork shown in the storefront header and footer.
                </FieldDescription>
                {logoFile && (
                  <FieldDescription>Selected: {logoFile.name}</FieldDescription>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !logoFile || uploading !== null || clearing !== null
                    }
                    type="button"
                    onClick={() => void uploadAsset("logo")}
                  >
                    {uploading === "logo" ? "Uploading…" : "Upload logo"}
                  </Button>
                  {settings.logo && (
                    <Button
                      disabled={uploading !== null || clearing !== null}
                      type="button"
                      variant="outline"
                      onClick={() => void clearAsset("logo")}
                    >
                      {clearing === "logo" ? "Removing…" : "Remove logo"}
                    </Button>
                  )}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="storefront-brand-icon">
                  Square brand icon
                </FieldLabel>
                <Input
                  ref={brandIconInput}
                  accept="image/png,image/webp"
                  id="storefront-brand-icon"
                  type="file"
                  onChange={(event) =>
                    setBrandIconFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                {settings.brandIcon ? (
                  <Image
                    alt="Current square brand icon preview"
                    className="size-16 rounded border border-border bg-background object-contain"
                    height={settings.brandIcon.height}
                    src={settings.brandIcon.src}
                    unoptimized
                    width={settings.brandIcon.width}
                  />
                ) : (
                  <FieldDescription>No brand icon uploaded.</FieldDescription>
                )}
                <FieldDescription>
                  Used for generated browser and app icons. Upload a square,
                  transparent PNG or WebP; a 1024 × 1024 source is recommended.
                </FieldDescription>
                {brandIconFile && (
                  <FieldDescription>
                    Selected: {brandIconFile.name}
                  </FieldDescription>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !brandIconFile || uploading !== null || clearing !== null
                    }
                    type="button"
                    onClick={() => void uploadAsset("brandIcon")}
                  >
                    {uploading === "brandIcon"
                      ? "Uploading…"
                      : "Upload brand icon"}
                  </Button>
                  {settings.brandIcon && (
                    <Button
                      disabled={uploading !== null || clearing !== null}
                      type="button"
                      variant="outline"
                      onClick={() => void clearAsset("brandIcon")}
                    >
                      {clearing === "brandIcon"
                        ? "Removing…"
                        : "Remove brand icon"}
                    </Button>
                  )}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="storefront-favicon">
                  Small browser favicon override
                </FieldLabel>
                <Input
                  ref={faviconInput}
                  accept="image/png,image/jpeg,image/webp"
                  id="storefront-favicon"
                  type="file"
                  onChange={(event) =>
                    setFaviconFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                {settings.favicon ? (
                  <Image
                    alt="Current favicon preview"
                    className="size-16 rounded border border-border object-contain"
                    height={settings.favicon.height}
                    src={settings.favicon.src}
                    unoptimized
                    width={settings.favicon.width}
                  />
                ) : (
                  <FieldDescription>No favicon uploaded.</FieldDescription>
                )}
                <FieldDescription>
                  Optional 64 × 64 override for browser tabs. The square brand
                  icon is used when this is empty.
                </FieldDescription>
                {faviconFile && (
                  <FieldDescription>
                    Selected: {faviconFile.name}
                  </FieldDescription>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !faviconFile || uploading !== null || clearing !== null
                    }
                    type="button"
                    onClick={() => void uploadAsset("favicon")}
                  >
                    {uploading === "favicon" ? "Uploading…" : "Upload favicon"}
                  </Button>
                  {settings.favicon && (
                    <Button
                      disabled={uploading !== null || clearing !== null}
                      type="button"
                      variant="outline"
                      onClick={() => void clearAsset("favicon")}
                    >
                      {clearing === "favicon" ? "Removing…" : "Remove favicon"}
                    </Button>
                  )}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="storefront-social-image">
                  Social sharing image
                </FieldLabel>
                <Input
                  ref={socialImageInput}
                  accept="image/png,image/jpeg,image/webp"
                  id="storefront-social-image"
                  type="file"
                  onChange={(event) =>
                    setSocialImageFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                {settings.socialImage ? (
                  <Image
                    alt={
                      settings.socialImageAlt ?? "Current social image preview"
                    }
                    className="aspect-[1200/630] w-full max-w-64 rounded border border-border object-cover"
                    height={settings.socialImage.height}
                    src={settings.socialImage.src}
                    unoptimized
                    width={settings.socialImage.width}
                  />
                ) : (
                  <FieldDescription>No social image uploaded.</FieldDescription>
                )}
                <FieldDescription>
                  Published as a 1200 × 630 JPEG for link previews.
                </FieldDescription>
                {socialImageFile && (
                  <FieldDescription>
                    Selected: {socialImageFile.name}
                  </FieldDescription>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !socialImageFile ||
                      uploading !== null ||
                      clearing !== null
                    }
                    type="button"
                    onClick={() => void uploadAsset("socialImage")}
                  >
                    {uploading === "socialImage"
                      ? "Uploading…"
                      : "Upload social image"}
                  </Button>
                  {settings.socialImage && (
                    <Button
                      disabled={uploading !== null || clearing !== null}
                      type="button"
                      variant="outline"
                      onClick={() => void clearAsset("socialImage")}
                    >
                      {clearing === "socialImage"
                        ? "Removing…"
                        : "Remove social image"}
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </section>

          <section
            aria-labelledby="storefront-appearance-heading"
            className="grid gap-5"
          >
            <div>
              <h3
                className="text-lg font-semibold"
                id="storefront-appearance-heading"
              >
                Storefront appearance
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure the storefront surface and brand accent colors.
                Background color also fills generated app icons; brand color is
                used by browser and installed-app chrome.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="storefront-brand-color">
                Brand color
              </FieldLabel>
              <Input
                id="storefront-brand-color"
                autoComplete="off"
                maxLength={9}
                pattern="#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?"
                placeholder="#7b2220"
                required
                spellCheck={false}
                {...register("brandColor")}
              />
              <FieldDescription>
                Sets the storefront brand accent and web app manifest theme
                color. Enter #RRGGBB or #RRGGBBAA.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="storefront-background-color">
                Background color
              </FieldLabel>
              <Input
                id="storefront-background-color"
                autoComplete="off"
                maxLength={9}
                pattern="#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?"
                placeholder="#fafafafa"
                required
                spellCheck={false}
                {...register("backgroundColor")}
              />
              <FieldDescription>
                Enter a CSS hexadecimal color: #RRGGBB or #RRGGBBAA.
              </FieldDescription>
            </Field>
          </section>

          <section
            aria-labelledby="seo-defaults-heading"
            className="grid gap-5"
          >
            <div>
              <h3 className="text-lg font-semibold" id="seo-defaults-heading">
                SEO and sharing defaults
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Used on the storefront home page and as defaults for pages that
                do not define their own metadata. Product pages use their own
                product details.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="storefront-seo-title">Site title</FieldLabel>
              <Input
                id="storefront-seo-title"
                maxLength={160}
                placeholder={`${siteName || "AARAJ"} | Products`}
                {...register("seoTitle")}
              />
              <FieldDescription>
                Optional title shown in search and link previews. Leave blank to
                use the store name. Search engines may shorten or rewrite
                titles.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="storefront-seo-description">
                Site description
              </FieldLabel>
              <Textarea
                id="storefront-seo-description"
                maxLength={500}
                placeholder={`Browse products from ${siteName || "AARAJ"}.`}
                {...register("seoDescription")}
              />
              <FieldDescription>
                Optional page summary. Leave blank to use a store-name-based
                description. Search engines may choose a different snippet.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="storefront-social-image-alt">
                Social image description
              </FieldLabel>
              <Input
                id="storefront-social-image-alt"
                maxLength={250}
                {...register("socialImageAlt")}
              />
              <FieldDescription>
                Describe the social image for assistive technology and link
                previews. Leave blank to use the store name.
              </FieldDescription>
            </Field>
          </section>

          <section
            aria-labelledby="store-identity-heading"
            className="grid gap-5"
          >
            <div>
              <h3 className="text-lg font-semibold" id="store-identity-heading">
                Store identity and contact
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Public details appear in the storefront header and footer.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="storefront-site-name">Store name</FieldLabel>
              <Input
                id="storefront-site-name"
                autoComplete="organization"
                maxLength={80}
                required
                {...register("siteName")}
              />
              <FieldDescription>
                Used as the storefront brand name and page title.
              </FieldDescription>
            </Field>

            <Field>
              <div className="flex items-center gap-3">
                <input
                  id="storefront-announcement-enabled"
                  className="size-4 accent-primary"
                  type="checkbox"
                  {...register("announcementEnabled")}
                />
                <FieldLabel htmlFor="storefront-announcement-enabled">
                  Show announcement banner
                </FieldLabel>
              </div>
              <Textarea
                id="storefront-announcement-text"
                aria-label="Announcement text"
                maxLength={160}
                placeholder="Step into the festive season with AARAJ"
                {...register("announcementText")}
              />
              <FieldDescription>
                Plain text only, up to 160 characters.
              </FieldDescription>
            </Field>

            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="storefront-support-phone">
                  Customer support phone
                </FieldLabel>
                <Input
                  id="storefront-support-phone"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={16}
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+8801XXXXXXXXX"
                  {...register("supportPhone")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="storefront-support-email">
                  Customer support email
                </FieldLabel>
                <Input
                  id="storefront-support-email"
                  autoComplete="email"
                  maxLength={254}
                  type="email"
                  {...register("supportEmail")}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="storefront-business-address">
                Business address
              </FieldLabel>
              <Textarea
                id="storefront-business-address"
                autoComplete="street-address"
                maxLength={500}
                {...register("businessAddress")}
              />
            </Field>
          </section>

          <section
            aria-labelledby="social-links-heading"
            className="grid gap-5"
          >
            <div>
              <h3 className="text-lg font-semibold" id="social-links-heading">
                Social links
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Only secure URLs from the selected social network are accepted.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {socialFields.map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`storefront-social-${key}`}>
                    {label}
                  </FieldLabel>
                  <Input
                    id={`storefront-social-${key}`}
                    autoComplete="url"
                    maxLength={2048}
                    placeholder={`https://${key === "x" ? "x.com" : `${key}.com`}/…`}
                    type="url"
                    {...register(`socialLinks.${key}`)}
                  />
                </Field>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="header-navigation-heading"
            className="grid gap-5 border-t border-border pt-6"
          >
            <div>
              <h3
                className="text-lg font-semibold"
                id="header-navigation-heading"
              >
                Header navigation
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Arrange up to eight links and active catalog categories. A
                category’s current name and URL come from catalog management.
              </p>
            </div>

            <ol className="grid gap-4">
              {headerNavigation.map((item, index) => {
                const otherCategoryIds = new Set(
                  headerNavigation.flatMap((candidate, candidateIndex) =>
                    candidateIndex !== index && candidate.type === "category"
                      ? [candidate.categoryId]
                      : [],
                  ),
                );
                const selectedCategory =
                  item.type === "category"
                    ? categoryOptions.find(({ id }) => id === item.categoryId)
                    : undefined;

                return (
                  <li
                    className="grid gap-3 rounded-lg border border-border p-4"
                    key={headerNavigationFields[index]?.id ?? index}
                  >
                    {item.type === "link" ? (
                      <div className="grid items-end gap-3 md:grid-cols-[1fr_2fr]">
                        <Field>
                          <FieldLabel htmlFor={`header-link-${index}-label`}>
                            Link label
                          </FieldLabel>
                          <Input
                            id={`header-link-${index}-label`}
                            maxLength={40}
                            {...register(`headerNavigation.${index}.label`)}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`header-link-${index}-href`}>
                            Link URL
                          </FieldLabel>
                          <Input
                            id={`header-link-${index}-href`}
                            maxLength={2048}
                            placeholder="/ or https://example.com"
                            {...register(`headerNavigation.${index}.href`)}
                          />
                        </Field>
                      </div>
                    ) : (
                      <Field>
                        <FieldLabel htmlFor={`header-category-${index}`}>
                          Catalog category
                        </FieldLabel>
                        <select
                          className="min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                          id={`header-category-${index}`}
                          value={item.categoryId}
                          onChange={(event) => {
                            const categoryId = event.currentTarget.value;
                            updateHeaderNavigationItem(index, {
                              type: "category",
                              categoryId,
                            });
                          }}
                        >
                          {!selectedCategory && (
                            <option value={item.categoryId}>
                              Unavailable category ({item.categoryId})
                            </option>
                          )}
                          {categoryOptions
                            .filter(
                              ({ id }) =>
                                id === item.categoryId ||
                                !otherCategoryIds.has(id),
                            )
                            .map(({ id, path }) => (
                              <option key={id} value={id}>
                                {path}
                              </option>
                            ))}
                        </select>
                        {!selectedCategory && (
                          <FieldDescription>
                            This category is inactive or unavailable. Remove it,
                            or choose an active category.
                          </FieldDescription>
                        )}
                      </Field>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        aria-label={`Move header item ${index + 1} up`}
                        disabled={index === 0}
                        type="button"
                        variant="outline"
                        onClick={() =>
                          moveHeaderNavigationItem(index, index - 1)
                        }
                      >
                        Move up
                      </Button>
                      <Button
                        aria-label={`Move header item ${index + 1} down`}
                        disabled={index === headerNavigation.length - 1}
                        type="button"
                        variant="outline"
                        onClick={() =>
                          moveHeaderNavigationItem(index, index + 1)
                        }
                      >
                        Move down
                      </Button>
                      <Button
                        aria-label={`Remove header item ${index + 1}`}
                        type="button"
                        variant="outline"
                        onClick={() => removeHeaderNavigationItem(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>

            {headerNavigation.length < 8 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Button
                    disabled={headerNavigation.length >= 8}
                    type="button"
                    variant="outline"
                    onClick={() =>
                      appendHeaderNavigationItem({
                        type: "link",
                        label: "",
                        href: "",
                      })
                    }
                  >
                    Add header link
                  </Button>
                </div>
                <Field>
                  <FieldLabel htmlFor="storefront-add-header-category">
                    Add an active category
                  </FieldLabel>
                  <select
                    className="min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    disabled={availableCategories.length === 0}
                    id="storefront-add-header-category"
                    value=""
                    onChange={(event) =>
                      addHeaderCategory(event.currentTarget.value)
                    }
                  >
                    <option value="">
                      {availableCategories.length > 0
                        ? "Choose a category…"
                        : "No additional active categories"}
                    </option>
                    {availableCategories.map(({ id, path }) => (
                      <option key={id} value={id}>
                        {path}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </section>

          <section
            aria-labelledby="footer-content-heading"
            className="grid gap-5"
          >
            <div>
              <h3 className="text-lg font-semibold" id="footer-content-heading">
                Footer content
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a short store description and up to eight information links.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="storefront-footer-description">
                Footer description
              </FieldLabel>
              <Textarea
                id="storefront-footer-description"
                maxLength={500}
                {...register("footerDescription")}
              />
            </Field>
            <div className="grid gap-4">
              {footerLinks.map((_, index) => (
                <div
                  className="grid items-end gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_2fr_auto_auto_auto]"
                  key={footerLinkFields[index]?.id ?? index}
                >
                  <Field>
                    <FieldLabel htmlFor={`footer-link-${index}-label`}>
                      Link label
                    </FieldLabel>
                    <Input
                      id={`footer-link-${index}-label`}
                      maxLength={40}
                      {...register(`footerLinks.${index}.label`)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`footer-link-${index}-href`}>
                      Link URL
                    </FieldLabel>
                    <Input
                      id={`footer-link-${index}-href`}
                      maxLength={2048}
                      placeholder="/about or https://example.com"
                      {...register(`footerLinks.${index}.href`)}
                    />
                  </Field>
                  <Button
                    aria-label={`Move footer link ${index + 1} up`}
                    disabled={index === 0}
                    type="button"
                    variant="outline"
                    onClick={() => moveFooterLink(index, index - 1)}
                  >
                    Move up
                  </Button>
                  <Button
                    aria-label={`Move footer link ${index + 1} down`}
                    disabled={index === footerLinks.length - 1}
                    type="button"
                    variant="outline"
                    onClick={() => moveFooterLink(index, index + 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    aria-label={`Remove footer link ${index + 1}`}
                    type="button"
                    variant="outline"
                    onClick={() => removeFooterLink(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {footerLinks.length < 8 && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => appendFooterLink({ label: "", href: "" })}
                  >
                    Add footer link
                  </Button>
                </div>
              )}
            </div>
          </section>

          <section className="grid gap-4 border-t border-border pt-6">
            <div>
              <Button
                disabled={
                  saving ||
                  uploading !== null ||
                  clearing !== null ||
                  !changed ||
                  (announcementEnabled && !announcementText.trim())
                }
                type="submit"
              >
                {saving ? "Saving…" : "Save storefront settings"}
              </Button>
            </div>
          </section>
        </form>
      ) : null}
    </section>
  );
}

function responseMessage(body: unknown, fallback: string): string {
  const result = ApiErrorResponseSchema.safeParse(body);
  if (!result.success) return fallback;
  if (result.data.errorCode === "STOREFRONT_SETTINGS_STALE") {
    return "These settings changed in another session. Reload this page and apply your change again.";
  }
  return Array.isArray(result.data.message)
    ? result.data.message.join(" ")
    : result.data.message;
}

function collectFieldErrorMessages(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return [record.message];
  return Object.entries(record)
    .filter(([key]) => key !== "ref" && key !== "types")
    .flatMap(([, nested]) => collectFieldErrorMessages(nested));
}

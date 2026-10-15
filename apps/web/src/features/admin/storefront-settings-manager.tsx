"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  StorefrontSettingsSchema,
  StorefrontSettingsUpdateSchema,
  type StorefrontBrandAssetKind,
  type StorefrontFooterLink,
  type StorefrontSettings,
  type StorefrontSocialLinks,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const socialFields = [
  ["instagram", "Instagram URL"],
  ["facebook", "Facebook URL"],
  ["tiktok", "TikTok URL"],
  ["youtube", "YouTube URL"],
  ["x", "X URL"],
] as const satisfies ReadonlyArray<
  readonly [keyof StorefrontSocialLinks, string]
>;
const assetLabels: Record<StorefrontBrandAssetKind, string> = {
  logo: "Logo",
  brandIcon: "Brand icon",
  favicon: "Favicon",
  socialImage: "Social image",
};

export function StorefrontSettingsManager() {
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [siteName, setSiteName] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [socialImageAlt, setSocialImageAlt] = useState("");
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [socialLinks, setSocialLinks] = useState<StorefrontSocialLinks>({
    instagram: null,
    facebook: null,
    tiktok: null,
    youtube: null,
    x: null,
  });
  const [footerDescription, setFooterDescription] = useState("");
  const [footerLinks, setFooterLinks] = useState<StorefrontFooterLink[]>([]);
  const [reason, setReason] = useState("");
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
  const logoInput = useRef<HTMLInputElement>(null);
  const brandIconInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);
  const socialImageInput = useRef<HTMLInputElement>(null);

  function applyTextSettings(value: StorefrontSettings) {
    setSiteName(value.siteName);
    setBrandColor(value.brandColor);
    setBackgroundColor(value.backgroundColor);
    setSeoTitle(value.seoTitle ?? "");
    setSeoDescription(value.seoDescription ?? "");
    setSocialImageAlt(value.socialImageAlt ?? "");
    setAnnouncementEnabled(value.announcementEnabled);
    setAnnouncementText(value.announcementText ?? "");
    setSupportPhone(value.supportPhone ?? "");
    setSupportEmail(value.supportEmail ?? "");
    setBusinessAddress(value.businessAddress ?? "");
    setSocialLinks(value.socialLinks);
    setFooterDescription(value.footerDescription ?? "");
    setFooterLinks(value.footerLinks);
  }

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
          applyTextSettings(result.data);
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
  }, []);

  const changed = Boolean(
    settings &&
    (siteName !== settings.siteName ||
      brandColor !== settings.brandColor ||
      backgroundColor !== settings.backgroundColor ||
      seoTitle !== (settings.seoTitle ?? "") ||
      seoDescription !== (settings.seoDescription ?? "") ||
      socialImageAlt !== (settings.socialImageAlt ?? "") ||
      announcementEnabled !== settings.announcementEnabled ||
      announcementText !== (settings.announcementText ?? "") ||
      supportPhone !== (settings.supportPhone ?? "") ||
      supportEmail !== (settings.supportEmail ?? "") ||
      businessAddress !== (settings.businessAddress ?? "") ||
      JSON.stringify(socialLinks) !== JSON.stringify(settings.socialLinks) ||
      footerDescription !== (settings.footerDescription ?? "") ||
      JSON.stringify(footerLinks) !== JSON.stringify(settings.footerLinks)),
  );

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving || !changed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input = StorefrontSettingsUpdateSchema.parse({
        siteName,
        brandColor: brandColor.trim(),
        backgroundColor: backgroundColor.trim(),
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
        announcementEnabled,
        announcementText: announcementText.trim() || null,
        supportPhone: supportPhone.trim() || null,
        supportEmail: supportEmail.trim() || null,
        businessAddress: businessAddress.trim() || null,
        socialImageAlt: socialImageAlt.trim() || null,
        socialLinks: Object.fromEntries(
          socialFields.map(([key]) => [key, socialLinks[key]?.trim() || null]),
        ),
        footerDescription: footerDescription.trim() || null,
        footerLinks: footerLinks.map(({ label, href }) => ({
          label: label.trim(),
          href: href.trim(),
        })),
        expectedVersion: settings.version,
        reason,
      });
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
      applyTextSettings(result.data);
      setReason("");
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
      form.set("reason", reason);
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
          body: JSON.stringify({ expectedVersion: settings.version, reason }),
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

  function updateFooterLink(
    index: number,
    field: keyof StorefrontFooterLink,
    value: string,
  ) {
    setFooterLinks((current) =>
      current.map((link, currentIndex) =>
        currentIndex === index ? { ...link, [field]: value } : link,
      ),
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Brand and store profile</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage the public identity, contact information, social links, and
        storefront footer.
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
          onSubmit={(event) => void save(event)}
        >
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
                      !logoFile ||
                      uploading !== null ||
                      clearing !== null ||
                      reason.trim().length < 3
                    }
                    type="button"
                    onClick={() => void uploadAsset("logo")}
                  >
                    {uploading === "logo" ? "Uploading…" : "Upload logo"}
                  </Button>
                  {settings.logo && (
                    <Button
                      disabled={
                        uploading !== null ||
                        clearing !== null ||
                        reason.trim().length < 3
                      }
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
                      !brandIconFile ||
                      uploading !== null ||
                      clearing !== null ||
                      reason.trim().length < 3
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
                      disabled={
                        uploading !== null ||
                        clearing !== null ||
                        reason.trim().length < 3
                      }
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
                      !faviconFile ||
                      uploading !== null ||
                      clearing !== null ||
                      reason.trim().length < 3
                    }
                    type="button"
                    onClick={() => void uploadAsset("favicon")}
                  >
                    {uploading === "favicon" ? "Uploading…" : "Upload favicon"}
                  </Button>
                  {settings.favicon && (
                    <Button
                      disabled={
                        uploading !== null ||
                        clearing !== null ||
                        reason.trim().length < 3
                      }
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
                      clearing !== null ||
                      reason.trim().length < 3
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
                      disabled={
                        uploading !== null ||
                        clearing !== null ||
                        reason.trim().length < 3
                      }
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
                value={brandColor}
                onChange={(event) => setBrandColor(event.currentTarget.value)}
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
                value={backgroundColor}
                onChange={(event) =>
                  setBackgroundColor(event.currentTarget.value)
                }
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
                value={seoTitle}
                onChange={(event) => setSeoTitle(event.currentTarget.value)}
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
                value={seoDescription}
                onChange={(event) =>
                  setSeoDescription(event.currentTarget.value)
                }
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
                value={socialImageAlt}
                onChange={(event) =>
                  setSocialImageAlt(event.currentTarget.value)
                }
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
                value={siteName}
                onChange={(event) => setSiteName(event.currentTarget.value)}
              />
              <FieldDescription>
                Used as the storefront brand name and page title.
              </FieldDescription>
            </Field>

            <Field>
              <div className="flex items-center gap-3">
                <input
                  id="storefront-announcement-enabled"
                  checked={announcementEnabled}
                  className="size-4 accent-primary"
                  type="checkbox"
                  onChange={(event) =>
                    setAnnouncementEnabled(event.currentTarget.checked)
                  }
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
                value={announcementText}
                onChange={(event) =>
                  setAnnouncementText(event.currentTarget.value)
                }
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
                  value={supportPhone}
                  onChange={(event) =>
                    setSupportPhone(event.currentTarget.value)
                  }
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
                  value={supportEmail}
                  onChange={(event) =>
                    setSupportEmail(event.currentTarget.value)
                  }
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
                value={businessAddress}
                onChange={(event) =>
                  setBusinessAddress(event.currentTarget.value)
                }
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
                    value={socialLinks[key] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value || null;
                      setSocialLinks((current) => ({
                        ...current,
                        [key]: value,
                      }));
                    }}
                  />
                </Field>
              ))}
            </div>
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
                value={footerDescription}
                onChange={(event) =>
                  setFooterDescription(event.currentTarget.value)
                }
              />
            </Field>
            <div className="grid gap-4">
              {footerLinks.map((link, index) => (
                <div
                  className="grid items-end gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_2fr_auto]"
                  key={`footer-link-${index}`}
                >
                  <Field>
                    <FieldLabel htmlFor={`footer-link-${index}-label`}>
                      Link label
                    </FieldLabel>
                    <Input
                      id={`footer-link-${index}-label`}
                      maxLength={40}
                      value={link.label}
                      onChange={(event) =>
                        updateFooterLink(
                          index,
                          "label",
                          event.currentTarget.value,
                        )
                      }
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
                      value={link.href}
                      onChange={(event) =>
                        updateFooterLink(
                          index,
                          "href",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </Field>
                  <Button
                    aria-label={`Remove footer link ${index + 1}`}
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setFooterLinks((current) =>
                        current.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      )
                    }
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
                    onClick={() =>
                      setFooterLinks((current) => [
                        ...current,
                        { label: "", href: "" },
                      ])
                    }
                  >
                    Add footer link
                  </Button>
                </div>
              )}
            </div>
          </section>

          <section className="grid gap-4 border-t border-border pt-6">
            <Field>
              <FieldLabel htmlFor="storefront-change-reason">
                Reason for this change
              </FieldLabel>
              <Textarea
                id="storefront-change-reason"
                maxLength={500}
                minLength={3}
                required
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Field>
            <div>
              <Button
                disabled={
                  saving ||
                  uploading !== null ||
                  clearing !== null ||
                  !changed ||
                  reason.trim().length < 3 ||
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

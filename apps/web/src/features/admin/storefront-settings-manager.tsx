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

export function StorefrontSettingsManager() {
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [siteName, setSiteName] = useState("");
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
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
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
  const faviconInput = useRef<HTMLInputElement>(null);

  function applyTextSettings(value: StorefrontSettings) {
    setSiteName(value.siteName);
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
        announcementEnabled,
        announcementText: announcementText.trim() || null,
        supportPhone: supportPhone.trim() || null,
        supportEmail: supportEmail.trim() || null,
        businessAddress: businessAddress.trim() || null,
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
      setNotice("Store profile and footer settings saved.");
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
    const file = kind === "logo" ? logoFile : faviconFile;
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
      } else {
        setFaviconFile(null);
        if (faviconInput.current) faviconInput.current.value = "";
      }
      setNotice(
        `${kind === "logo" ? "Logo" : "Favicon"} uploaded and published.`,
      );
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
      setNotice(`${kind === "logo" ? "Logo" : "Favicon"} removed.`);
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
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="storefront-logo">Store logo</FieldLabel>
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
                <FieldLabel htmlFor="storefront-favicon">Favicon</FieldLabel>
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
            </div>
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
                {saving ? "Saving…" : "Save store profile"}
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

"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ApiErrorResponseSchema,
  StorefrontSettingsSchema,
  type CatalogCategoryOption,
  type StorefrontBrandAssetKind,
  type StorefrontSettings,
  type StorefrontSettingsUpdate,
} from "@aaraj/contracts";
import { ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { AdminFormContentSkeleton } from "@/components/admin/admin-page-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SortableList } from "@/components/dnd/sortable-list";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { hasDirtyFieldsExcept } from "@/lib/form-dirty-state";
import { getApiErrorMessage } from "@/lib/api-error";
import {
  clearStorefrontBrandAsset,
  fetchManagedStorefrontSettings,
  updateManagedStorefrontSettings,
  uploadStorefrontBrandAsset,
} from "@/features/storefront/admin/storefront-management-client";
import { HomepageCategorySettings } from "./homepage-category-settings";
import {
  socialFields,
  storefrontSettingsFormSchema,
  toStorefrontSettingsDraft,
  type StorefrontSettingsDraft,
  type StorefrontSettingsFormValues,
} from "./storefront-settings-form";
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFormRegister,
} from "react-hook-form";
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
  const [activeTab, setActiveTab] = useState("brand");
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
        linkedin: "",
      },
      footerDescription: "",
      footerLinkGroups: { about: [], policies: [] },
      footerCategoryIds: [],
      homepageCategoriesEnabled: false,
      homepageCategoryIds: [],
      headerNavigation: [],
      expectedVersion: 1,
    },
  });
  const {
    fields: aboutLinkFields,
    append: appendAboutLink,
    remove: removeAboutLink,
  } = useFieldArray({ control, name: "footerLinkGroups.about" });
  const {
    fields: policyLinkFields,
    append: appendPolicyLink,
    remove: removePolicyLink,
  } = useFieldArray({ control, name: "footerLinkGroups.policies" });
  const {
    append: appendHeaderNavigationItem,
    remove: removeHeaderNavigationItem,
    move: moveHeaderNavigationItem,
    update: updateHeaderNavigationItem,
  } = useFieldArray({ control, name: "headerNavigation" });
  const footerLinkGroups = useWatch({ control, name: "footerLinkGroups" }) ?? {
    about: [],
    policies: [],
  };
  const footerCategoryIds =
    useWatch({ control, name: "footerCategoryIds" }) ?? [];
  const homepageCategoryIds =
    useWatch({ control, name: "homepageCategoryIds" }) ?? [];
  const homepageCategoriesEnabled =
    useWatch({ control, name: "homepageCategoriesEnabled" }) ?? false;
  const headerNavigation =
    useWatch({ control, name: "headerNavigation" }) ?? [];
  const announcementEnabled =
    useWatch({ control, name: "announcementEnabled" }) ?? false;
  const siteName = useWatch({ control, name: "siteName" }) ?? "";
  const brandColor = useWatch({ control, name: "brandColor" }) ?? "";
  const backgroundColor = useWatch({ control, name: "backgroundColor" }) ?? "";
  const changed =
    settings && hasDirtyFieldsExcept(dirtyFields, ["expectedVersion"]);
  const logoInput = useRef<HTMLInputElement>(null);
  const brandIconInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);
  const socialImageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetchManagedStorefrontSettings()
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
    try {
      const response = await updateManagedStorefrontSettings(input);
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
      toast.add({ title: "Storefront settings saved", type: "success" });
    } catch (saveError) {
      toast.add({
        title: "Could not save storefront settings",
        description:
          saveError instanceof Error ? saveError.message : "Please try again.",
        type: "error",
      });
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
    try {
      const response = await uploadStorefrontBrandAsset(
        kind,
        file,
        settings.version,
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
      toast.add({
        title: `${assetLabels[kind]} uploaded`,
        description: "Your storefront image is now live.",
        type: "success",
      });
    } catch (uploadError) {
      toast.add({
        title: `Could not upload ${assetLabels[kind].toLowerCase()}`,
        description:
          uploadError instanceof Error
            ? uploadError.message
            : "Please try again.",
        type: "error",
      });
    } finally {
      setUploading(null);
    }
  }

  async function clearAsset(kind: StorefrontBrandAssetKind) {
    if (!settings || uploading || clearing) return;
    setClearing(kind);
    try {
      const response = await clearStorefrontBrandAsset(kind, settings.version);
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
      toast.add({
        title: `${assetLabels[kind]} removed`,
        description: "Your storefront has been updated.",
        type: "success",
      });
    } catch (clearError) {
      toast.add({
        title: `Could not remove ${assetLabels[kind].toLowerCase()}`,
        description:
          clearError instanceof Error
            ? clearError.message
            : "Please try again.",
        type: "error",
      });
    } finally {
      setClearing(null);
    }
  }

  function addHeaderCategory(categoryId: string) {
    if (!categoryId) return;
    appendHeaderNavigationItem({ type: "category", categoryId });
  }

  function addFooterCategory(categoryId: string) {
    if (!categoryId || footerCategoryIds.includes(categoryId)) {
      return;
    }
    setValue("footerCategoryIds", [...footerCategoryIds, categoryId], {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function removeFooterCategory(categoryId: string) {
    setValue(
      "footerCategoryIds",
      footerCategoryIds.filter((configuredId) => configuredId !== categoryId),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function addHomepageCategory(categoryId: string) {
    if (!categoryId || homepageCategoryIds.includes(categoryId)) return;
    setValue("homepageCategoryIds", [...homepageCategoryIds, categoryId], {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function removeHomepageCategory(categoryId: string) {
    setValue(
      "homepageCategoryIds",
      homepageCategoryIds.filter((configuredId) => configuredId !== categoryId),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function moveHomepageCategory(fromIndex: number, toIndex: number) {
    const reorderedCategoryIds = [...homepageCategoryIds];
    const [categoryId] = reorderedCategoryIds.splice(fromIndex, 1);
    if (categoryId === undefined) return;

    reorderedCategoryIds.splice(toIndex, 0, categoryId);
    setValue("homepageCategoryIds", reorderedCategoryIds, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  const configuredCategoryIds = new Set(
    headerNavigation.map(({ categoryId }) => categoryId),
  );
  const availableCategories = categoryOptions.filter(
    ({ id }) => !configuredCategoryIds.has(id),
  );

  function showValidationErrors(formErrors: typeof errors) {
    const fields = Object.keys(formErrors);
    if (
      fields.some((field) =>
        [
          "headerNavigation",
          "homepageCategoryIds",
          "homepageCategoriesEnabled",
          "footerDescription",
          "footerLinkGroups",
          "footerCategoryIds",
        ].includes(field),
      )
    ) {
      setActiveTab("content");
    } else if (
      fields.some((field) =>
        [
          "siteName",
          "announcementEnabled",
          "announcementText",
          "supportPhone",
          "supportEmail",
          "businessAddress",
          "socialLinks",
        ].includes(field),
      )
    ) {
      setActiveTab("contact");
    } else if (
      fields.some((field) =>
        ["seoTitle", "seoDescription", "socialImageAlt"].includes(field),
      )
    ) {
      setActiveTab("seo");
    } else {
      setActiveTab("brand");
    }
  }

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <h2 className="text-lg font-semibold">Store configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your brand, storefront content, contact details, and search
          appearance.
        </p>
      </div>

      {error && (
        <p
          className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:mx-6"
          role="alert"
        >
          {error}
        </p>
      )}
      {loading ? (
        <div className="px-5 py-5 sm:px-6">
          <AdminFormContentSkeleton label="storefront settings" />
        </div>
      ) : settings ? (
        <form
          className="grid"
          noValidate
          onSubmit={handleSubmit(save, showValidationErrors)}
        >
          <div className="grid gap-5 px-5 py-5 sm:px-6">
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
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (typeof value === "string") setActiveTab(value);
              }}
            >
              <TabsList aria-label="Storefront settings sections">
                <TabsTrigger value="brand">Brand</TabsTrigger>
                <TabsTrigger value="contact">Store</TabsTrigger>
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="seo">SEO</TabsTrigger>
              </TabsList>
              <TabsContent keepMounted value="brand">
                <div className="grid gap-7">
                  <section
                    aria-labelledby="brand-assets-heading"
                    className="grid gap-4"
                  >
                    <SectionHeading
                      id="brand-assets-heading"
                      title="Brand assets"
                      description="Add the images customers see across your store and when they share a link."
                    />
                    <p className="text-xs text-muted-foreground">
                      Up to 5 MB per image · formats vary by asset
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <AssetUploadCard
                        title="Store logo"
                        description="Wide header and footer artwork. PNG, JPEG or WebP."
                        accept="image/png,image/jpeg,image/webp"
                        inputRef={logoInput}
                        current={settings.logo}
                        file={logoFile}
                        uploadLabel="Upload logo"
                        uploading={uploading === "logo"}
                        clearing={clearing === "logo"}
                        disabled={uploading !== null || clearing !== null}
                        onFileChange={setLogoFile}
                        onUpload={() => void uploadAsset("logo")}
                        onClear={() => void clearAsset("logo")}
                      />
                      <AssetUploadCard
                        title="Brand icon"
                        description="Square PNG or WebP. 1024 × 1024 source recommended."
                        accept="image/png,image/webp"
                        inputRef={brandIconInput}
                        current={settings.brandIcon}
                        file={brandIconFile}
                        uploadLabel="Upload icon"
                        uploading={uploading === "brandIcon"}
                        clearing={clearing === "brandIcon"}
                        disabled={uploading !== null || clearing !== null}
                        onFileChange={setBrandIconFile}
                        onUpload={() => void uploadAsset("brandIcon")}
                        onClear={() => void clearAsset("brandIcon")}
                      />
                      <AssetUploadCard
                        title="Favicon"
                        description="Optional 64 × 64 browser tab icon. Brand icon is the default."
                        accept="image/png,image/jpeg,image/webp"
                        inputRef={faviconInput}
                        current={settings.favicon}
                        file={faviconFile}
                        uploadLabel="Upload favicon"
                        uploading={uploading === "favicon"}
                        clearing={clearing === "favicon"}
                        disabled={uploading !== null || clearing !== null}
                        onFileChange={setFaviconFile}
                        onUpload={() => void uploadAsset("favicon")}
                        onClear={() => void clearAsset("favicon")}
                      />
                      <AssetUploadCard
                        title="Social sharing image"
                        description="Landscape image for link previews. Published at 1200 × 630."
                        accept="image/png,image/jpeg,image/webp"
                        inputRef={socialImageInput}
                        current={settings.socialImage}
                        file={socialImageFile}
                        uploadLabel="Upload image"
                        uploading={uploading === "socialImage"}
                        clearing={clearing === "socialImage"}
                        disabled={uploading !== null || clearing !== null}
                        onFileChange={setSocialImageFile}
                        onUpload={() => void uploadAsset("socialImage")}
                        onClear={() => void clearAsset("socialImage")}
                      />
                    </div>
                  </section>

                  <section
                    aria-labelledby="storefront-appearance-heading"
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="font-semibold"
                        id="storefront-appearance-heading"
                      >
                        Appearance
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Set the brand accent and page background colors.
                      </p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field>
                        <FieldLabel
                          className="flex items-center justify-between"
                          htmlFor="storefront-brand-color"
                        >
                          Brand color
                          <span
                            aria-hidden="true"
                            className="size-5 rounded-md border border-border"
                            style={{ backgroundColor: brandColor || undefined }}
                          />
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
                          Hex value such as #7b2220.
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel
                          className="flex items-center justify-between"
                          htmlFor="storefront-background-color"
                        >
                          Background color
                          <span
                            aria-hidden="true"
                            className="size-5 rounded-md border border-border"
                            style={{
                              backgroundColor: backgroundColor || undefined,
                            }}
                          />
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
                          Hex value such as #fafafa.
                        </FieldDescription>
                      </Field>
                    </div>
                  </section>
                </div>
              </TabsContent>

              <TabsContent keepMounted value="seo">
                <div className="grid gap-7">
                  <section
                    aria-labelledby="seo-defaults-heading"
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="text-lg font-semibold"
                        id="seo-defaults-heading"
                      >
                        Search and sharing
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Defaults for search results and link previews.
                      </p>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="storefront-seo-title">
                        Site title
                      </FieldLabel>
                      <Input
                        id="storefront-seo-title"
                        maxLength={160}
                        placeholder={`${siteName || "AARAJ"} | Products`}
                        {...register("seoTitle")}
                      />
                      <FieldDescription>
                        Leave blank to use the store name.
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
                        Leave blank to use the default store description.
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
                        Describe the social image for accessibility.
                      </FieldDescription>
                    </Field>
                  </section>
                </div>
              </TabsContent>

              <TabsContent keepMounted value="contact">
                <div className="grid gap-7">
                  <section
                    aria-labelledby="store-identity-heading"
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="text-lg font-semibold"
                        id="store-identity-heading"
                      >
                        Store identity
                      </h3>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="storefront-site-name">
                        Store name
                      </FieldLabel>
                      <Input
                        id="storefront-site-name"
                        autoComplete="organization"
                        maxLength={80}
                        required
                        {...register("siteName")}
                      />
                      <FieldDescription>
                        Shown across your storefront.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                        <div className="grid gap-0.5">
                          <FieldLabel htmlFor="storefront-announcement-enabled">
                            Announcement banner
                          </FieldLabel>
                          <FieldDescription>
                            Show a short message at the top of your store.
                          </FieldDescription>
                        </div>
                        <Switch
                          id="storefront-announcement-enabled"
                          checked={announcementEnabled}
                          onCheckedChange={(enabled) =>
                            setValue("announcementEnabled", enabled, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                      </div>
                      {announcementEnabled && (
                        <>
                          <Textarea
                            id="storefront-announcement-text"
                            aria-label="Announcement text"
                            maxLength={160}
                            placeholder="Step into the festive season with AARAJ"
                            {...register("announcementText")}
                          />
                          <FieldDescription>
                            Plain text · up to 160 characters.
                          </FieldDescription>
                        </>
                      )}
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
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="text-lg font-semibold"
                        id="social-links-heading"
                      >
                        Social links
                      </h3>
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
                </div>
              </TabsContent>

              <TabsContent keepMounted value="content">
                <div className="grid gap-7">
                  <section
                    aria-labelledby="header-navigation-heading"
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="text-lg font-semibold"
                        id="header-navigation-heading"
                      >
                        Header navigation
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Select active catalog categories and drag to set their
                        display order.
                      </p>
                    </div>

                    {headerNavigation.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                        No header categories added yet.
                      </p>
                    ) : (
                      <SortableList
                        ariaLabel="Header navigation categories"
                        className="grid gap-3"
                        getItemId={({ categoryId }) => categoryId}
                        getItemLabel={(item, index) => {
                          const category = categoryOptions.find(
                            ({ id }) => id === item.categoryId,
                          );
                          return `${category?.path ?? "Unavailable category"}, position ${index + 1}`;
                        }}
                        itemClassName="grid gap-3 rounded-lg border border-border p-4"
                        items={headerNavigation}
                        onMove={moveHeaderNavigationItem}
                        renderItem={(item, index, handle) => {
                          const otherCategoryIds = new Set(
                            headerNavigation
                              .filter(
                                (_, candidateIndex) => candidateIndex !== index,
                              )
                              .map(({ categoryId }) => categoryId),
                          );
                          const selectedCategory = categoryOptions.find(
                            ({ id }) => id === item.categoryId,
                          );
                          const categoryOptionsForItem = categoryOptions.filter(
                            ({ id }) =>
                              id === item.categoryId ||
                              !otherCategoryIds.has(id),
                          );
                          const categorySelectItems = [
                            ...(!selectedCategory
                              ? [
                                  {
                                    value: item.categoryId,
                                    label: "Unavailable category",
                                  },
                                ]
                              : []),
                            ...categoryOptionsForItem.map(({ id, path }) => ({
                              label: path,
                              value: id,
                            })),
                          ];

                          return (
                            <>
                              <Field>
                                <FieldLabel
                                  htmlFor={`header-category-${index}`}
                                >
                                  Catalog category
                                </FieldLabel>
                                <Select
                                  items={categorySelectItems}
                                  value={item.categoryId}
                                  onValueChange={(categoryId) => {
                                    if (!categoryId) return;
                                    updateHeaderNavigationItem(index, {
                                      type: "category",
                                      categoryId,
                                    });
                                  }}
                                >
                                  <SelectTrigger
                                    id={`header-category-${index}`}
                                  >
                                    <SelectValue placeholder="Choose a category" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {!selectedCategory && (
                                      <SelectItem value={item.categoryId}>
                                        Unavailable category
                                      </SelectItem>
                                    )}
                                    {categoryOptionsForItem.map(
                                      ({ id, path }) => (
                                        <SelectItem key={id} value={id}>
                                          {path}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                                {!selectedCategory && (
                                  <FieldDescription>
                                    This category is inactive or unavailable.
                                    Remove it, or choose an active category.
                                  </FieldDescription>
                                )}
                              </Field>
                              <div className="flex items-center gap-1">
                                {handle}
                                <Button
                                  aria-label={`Remove header item ${index + 1}`}
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    removeHeaderNavigationItem(index)
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </>
                          );
                        }}
                      />
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="storefront-add-header-category">
                          Add an active category
                        </FieldLabel>
                        <Select
                          value={null}
                          onValueChange={(categoryId) => {
                            if (categoryId) addHeaderCategory(categoryId);
                          }}
                          disabled={availableCategories.length === 0}
                        >
                          <SelectTrigger id="storefront-add-header-category">
                            <SelectValue
                              placeholder={
                                availableCategories.length > 0
                                  ? "Choose a category…"
                                  : "No additional active categories"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {availableCategories.map(({ id, path }) => (
                              <SelectItem key={id} value={id}>
                                {path}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </section>

                  <HomepageCategorySettings
                    categories={categoryOptions}
                    selectedCategoryIds={homepageCategoryIds}
                    enabled={homepageCategoriesEnabled}
                    onEnabledChange={(enabled) =>
                      setValue("homepageCategoriesEnabled", enabled, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    onCategoryAdd={addHomepageCategory}
                    onCategoryRemove={removeHomepageCategory}
                    onCategoryMove={moveHomepageCategory}
                  />

                  <section
                    aria-labelledby="footer-content-heading"
                    className="grid gap-5 rounded-xl border border-border p-4 sm:p-5"
                  >
                    <div>
                      <h3
                        className="text-lg font-semibold"
                        id="footer-content-heading"
                      >
                        Footer content
                      </h3>
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
                    <Field>
                      <FieldLabel htmlFor="storefront-footer-category">
                        Footer categories
                      </FieldLabel>
                      <Select
                        value={null}
                        onValueChange={(categoryId) => {
                          if (categoryId) addFooterCategory(categoryId);
                        }}
                      >
                        <SelectTrigger id="storefront-footer-category">
                          <SelectValue placeholder="Add a catalog category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions
                            .filter(({ id }) => !footerCategoryIds.includes(id))
                            .map(({ id, path }) => (
                              <SelectItem key={id} value={id}>
                                {path}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Categories follow the catalog order.
                      </FieldDescription>
                      {footerCategoryIds.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                          {footerCategoryIds.map((categoryId) => {
                            const category = categoryOptions.find(
                              ({ id }) => id === categoryId,
                            );
                            return (
                              <li
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 py-1 pl-3 pr-1 text-sm"
                                key={categoryId}
                              >
                                <span>
                                  {category?.path ?? "Unavailable category"}
                                </span>
                                <Button
                                  aria-label={`Remove ${category?.path ?? "unavailable category"} from footer`}
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="rounded-full text-muted-foreground"
                                  onClick={() =>
                                    removeFooterCategory(categoryId)
                                  }
                                >
                                  <X />
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </Field>

                    <FooterLinkGroupFields
                      append={appendAboutLink}
                      fields={aboutLinkFields}
                      group="about"
                      links={footerLinkGroups.about}
                      register={register}
                      remove={removeAboutLink}
                    />
                    <FooterLinkGroupFields
                      append={appendPolicyLink}
                      fields={policyLinkFields}
                      group="policies"
                      links={footerLinkGroups.policies}
                      register={register}
                      remove={removePolicyLink}
                    />
                  </section>
                </div>
              </TabsContent>
            </Tabs>
            <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              <div aria-live="polite" className="text-sm text-muted-foreground">
                {changed ? "Unsaved changes" : null}
              </div>
              <Button
                disabled={
                  saving || uploading !== null || clearing !== null || !changed
                }
                type="submit"
              >
                {saving ? (
                  <>
                    <LoaderCircle className="animate-spin" /> Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </div>
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
  return getApiErrorMessage(body, fallback);
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h3 className="font-semibold" id={id}>
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

type StorefrontAssetPreview = NonNullable<StorefrontSettings["logo"]>;

function AssetUploadCard({
  title,
  description,
  accept,
  inputRef,
  current,
  file,
  uploadLabel,
  uploading,
  clearing,
  disabled,
  onFileChange,
  onUpload,
  onClear,
}: {
  title: string;
  description: string;
  accept: string;
  inputRef: RefObject<HTMLInputElement | null>;
  current: StorefrontAssetPreview | null;
  file: File | null;
  uploadLabel: string;
  uploading: boolean;
  clearing: boolean;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  onClear: () => void;
}) {
  const inputId = `storefront-asset-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <Card className="h-full border-0 bg-muted/20 shadow-none ring-1 ring-border">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <p className="min-h-10 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 pb-4">
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-border bg-background p-3">
          {current ? (
            <Image
              alt={`${title} preview`}
              className="max-h-full max-w-full object-contain"
              height={current.height}
              src={current.src}
              unoptimized
              width={current.width}
            />
          ) : (
            <div className="grid justify-items-center gap-1 text-muted-foreground">
              <ImagePlus aria-hidden="true" className="size-5" />
              <span className="text-xs">No image</span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            ref={inputRef}
            accept={accept}
            aria-hidden="true"
            className="sr-only"
            id={inputId}
            tabIndex={-1}
            type="file"
            onChange={(event) =>
              onFileChange(event.currentTarget.files?.[0] ?? null)
            }
          />
          <Button
            aria-label={`Choose ${title.toLowerCase()} file`}
            className="min-w-0 flex-1"
            disabled={disabled}
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus />
            <span className="truncate">Choose file</span>
          </Button>
          {current && (
            <Button
              aria-label={`Remove ${title.toLowerCase()}`}
              className="text-muted-foreground hover:text-destructive"
              disabled={disabled}
              size="icon"
              type="button"
              variant="ghost"
              onClick={onClear}
            >
              {clearing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
            </Button>
          )}
        </div>
        {file && (
          <p
            className="truncate text-xs text-muted-foreground"
            title={file.name}
          >
            {file.name}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!file || disabled}
          size="sm"
          type="button"
          onClick={onUpload}
        >
          {uploading ? (
            <>
              <LoaderCircle className="animate-spin" /> Uploading…
            </>
          ) : (
            uploadLabel
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function collectFieldErrorMessages(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return [record.message];
  const messages = Object.entries(record)
    .filter(([key]) => key !== "ref" && key !== "types")
    .flatMap(([, nested]) => collectFieldErrorMessages(nested));
  return [...new Set(messages)];
}

type FooterLinkGroupName = keyof StorefrontSettingsDraft["footerLinkGroups"];
type FooterLink = StorefrontSettingsDraft["footerLinkGroups"]["about"][number];

function FooterLinkGroupFields({
  append,
  fields,
  group,
  links,
  register,
  remove,
}: {
  append: (link: FooterLink) => void;
  fields: Array<{ id: string }>;
  group: FooterLinkGroupName;
  links: FooterLink[];
  register: UseFormRegister<StorefrontSettingsDraft>;
  remove: (index: number) => void;
}) {
  const title = group === "about" ? "About Us" : "Policies";

  return (
    <section aria-labelledby={`footer-${group}-heading`} className="grid gap-4">
      <div>
        <h4 className="font-medium" id={`footer-${group}-heading`}>
          {title}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Links are displayed alphabetically.
        </p>
      </div>
      <div className="grid gap-4">
        {links.map((_, index) => {
          const fieldName = `footerLinkGroups.${group}.${index}` as const;
          return (
            <div
              className="grid items-end gap-3 rounded-lg border border-border p-4 md:grid-cols-4"
              key={fields[index]?.id ?? index}
            >
              <Field className="md:col-span-1">
                <FieldLabel htmlFor={`footer-${group}-${index}-label`}>
                  Link label
                </FieldLabel>
                <Input
                  id={`footer-${group}-${index}-label`}
                  maxLength={40}
                  {...register(`${fieldName}.label`)}
                />
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor={`footer-${group}-${index}-href`}>
                  Link URL
                </FieldLabel>
                <Input
                  id={`footer-${group}-${index}-href`}
                  maxLength={2048}
                  placeholder="/about or https://example.com"
                  {...register(`${fieldName}.href`)}
                />
              </Field>
              <Button
                aria-label={`Remove ${title} link ${index + 1}`}
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive md:justify-self-end"
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => append({ label: "", href: "" })}
          >
            Add {title.toLowerCase()} link
          </Button>
        </div>
      </div>
    </section>
  );
}

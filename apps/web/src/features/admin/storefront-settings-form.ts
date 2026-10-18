import {
  StorefrontHeaderNavigationItemSchema,
  StorefrontFooterLinkGroupsSchema,
  StorefrontSettingsUpdateSchema,
  type StorefrontSettings,
  type StorefrontSettingsUpdate,
  type StorefrontSocialLinks,
} from "@aaraj/contracts";
import { z } from "zod";

export const socialFields = [
  ["instagram", "Instagram URL"],
  ["facebook", "Facebook URL"],
  ["tiktok", "TikTok URL"],
  ["youtube", "YouTube URL"],
  ["x", "X URL"],
  ["linkedin", "LinkedIn URL"],
] as const satisfies ReadonlyArray<
  readonly [keyof StorefrontSocialLinks, string]
>;

const storefrontSettingsDraftSchema = z.strictObject({
  siteName: z.string(),
  brandColor: z.string(),
  backgroundColor: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  socialImageAlt: z.string(),
  announcementEnabled: z.boolean(),
  announcementText: z.string(),
  supportPhone: z.string(),
  supportEmail: z.string(),
  businessAddress: z.string(),
  socialLinks: z.strictObject({
    instagram: z.string(),
    facebook: z.string(),
    tiktok: z.string(),
    youtube: z.string(),
    x: z.string(),
    linkedin: z.string(),
  }),
  footerDescription: z.string(),
  footerLinkGroups: z.strictObject({
    about: z.array(z.strictObject({ label: z.string(), href: z.string() })),
    policies: z.array(z.strictObject({ label: z.string(), href: z.string() })),
  }),
  footerCategoryIds: z.array(z.uuid()),
  headerNavigation: StorefrontHeaderNavigationItemSchema.array(),
  expectedVersion: z.number().int().positive(),
});

export type StorefrontSettingsDraft = z.input<
  typeof storefrontSettingsDraftSchema
>;

function toStorefrontSettingsUpdate(
  values: StorefrontSettingsDraft,
): StorefrontSettingsUpdate {
  const socialLinks = Object.fromEntries(
    socialFields.map(([key]) => [key, values.socialLinks[key].trim() || null]),
  ) as StorefrontSocialLinks;

  const footerLinkGroups = StorefrontFooterLinkGroupsSchema.parse({
    about: values.footerLinkGroups.about.map(({ label, href }) => ({
      label: label.trim(),
      href: href.trim(),
    })),
    policies: values.footerLinkGroups.policies.map(({ label, href }) => ({
      label: label.trim(),
      href: href.trim(),
    })),
  });

  return {
    siteName: values.siteName,
    brandColor: values.brandColor.trim(),
    backgroundColor: values.backgroundColor.trim(),
    seoTitle: values.seoTitle.trim() || null,
    seoDescription: values.seoDescription.trim() || null,
    announcementEnabled: values.announcementEnabled,
    announcementText: values.announcementText.trim() || null,
    supportPhone: values.supportPhone.trim() || null,
    supportEmail: values.supportEmail.trim() || null,
    businessAddress: values.businessAddress.trim() || null,
    socialImageAlt: values.socialImageAlt.trim() || null,
    socialLinks,
    headerNavigation: values.headerNavigation.map((item) =>
      item.type === "link"
        ? { ...item, label: item.label.trim(), href: item.href.trim() }
        : item,
    ),
    footerDescription: values.footerDescription.trim() || null,
    footerLinkGroups,
    footerCategoryIds: values.footerCategoryIds,
    expectedVersion: values.expectedVersion,
  };
}

export const storefrontSettingsFormSchema = storefrontSettingsDraftSchema
  .superRefine((values, context) => {
    const validation = StorefrontSettingsUpdateSchema.safeParse(
      toStorefrontSettingsUpdate(values),
    );
    if (validation.success) return;

    for (const issue of validation.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  })
  .transform(toStorefrontSettingsUpdate);

export type StorefrontSettingsFormValues = z.output<
  typeof storefrontSettingsFormSchema
>;

export function toStorefrontSettingsDraft(
  settings: StorefrontSettings,
): StorefrontSettingsDraft {
  return {
    siteName: settings.siteName,
    brandColor: settings.brandColor,
    backgroundColor: settings.backgroundColor,
    seoTitle: settings.seoTitle ?? "",
    seoDescription: settings.seoDescription ?? "",
    socialImageAlt: settings.socialImageAlt ?? "",
    announcementEnabled: settings.announcementEnabled,
    announcementText: settings.announcementText ?? "",
    supportPhone: settings.supportPhone ?? "",
    supportEmail: settings.supportEmail ?? "",
    businessAddress: settings.businessAddress ?? "",
    socialLinks: {
      instagram: settings.socialLinks.instagram ?? "",
      facebook: settings.socialLinks.facebook ?? "",
      tiktok: settings.socialLinks.tiktok ?? "",
      youtube: settings.socialLinks.youtube ?? "",
      x: settings.socialLinks.x ?? "",
      linkedin: settings.socialLinks.linkedin ?? "",
    },
    footerDescription: settings.footerDescription ?? "",
    footerLinkGroups: settings.footerLinkGroups,
    footerCategoryIds: settings.footerCategoryIds,
    headerNavigation: settings.headerNavigation,
    expectedVersion: settings.version,
  };
}

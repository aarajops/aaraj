import { z } from "zod";

export const STOREFRONT_SETTINGS_ID = "default" as const;

const StoreNameSchema = z.string().trim().min(1).max(80);
const AnnouncementTextSchema = z.string().trim().min(1).max(160).nullable();
const StorefrontPhoneSchema = z
  .string()
  .regex(/^\+[1-9][0-9]{7,14}$/, "Use an international E.164 phone number.")
  .nullable();

export const PublicStorefrontSettingsSchema = z.strictObject({
  siteName: StoreNameSchema,
  announcementEnabled: z.boolean(),
  announcementText: AnnouncementTextSchema,
  supportPhone: StorefrontPhoneSchema,
});
export type PublicStorefrontSettings = z.infer<
  typeof PublicStorefrontSettingsSchema
>;

export const StorefrontSettingsSchema = PublicStorefrontSettingsSchema.extend({
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime().nullable(),
});
export type StorefrontSettings = z.infer<typeof StorefrontSettingsSchema>;

export const StorefrontSettingsUpdateSchema = z
  .strictObject({
    siteName: StoreNameSchema,
    announcementEnabled: z.boolean(),
    announcementText: AnnouncementTextSchema,
    supportPhone: StorefrontPhoneSchema,
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((settings, context) => {
    if (settings.announcementEnabled && !settings.announcementText) {
      context.addIssue({
        code: "custom",
        path: ["announcementText"],
        message: "An announcement is required when the banner is enabled.",
      });
    }
  });
export type StorefrontSettingsUpdate = z.infer<
  typeof StorefrontSettingsUpdateSchema
>;

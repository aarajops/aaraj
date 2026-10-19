import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  PublicStorefrontSettings,
  StorefrontSettings,
  StorefrontSettingsUpdate,
} from "@aaraj/contracts";
import {
  PublicStorefrontSettingsSchema,
  StorefrontBrandIconAssetSchema,
  StorefrontFooterLinkGroupsSchema,
  StorefrontHeaderNavigationItemSchema,
  StorefrontSettingsSchema,
  getStorefrontCategoryHref,
} from "@aaraj/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import { CategoryService } from "../catalog/category.service.js";
import {
  storefrontBrandAsset,
  storefrontConfiguration,
} from "./storefront-schema.js";
import { toStorefrontBrandAsset } from "./storefront-brand-asset.util.js";

@Injectable()
export class StorefrontSettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly categories: CategoryService,
  ) {}

  async getPublicSettings(): Promise<PublicStorefrontSettings> {
    const configuration = await this.readConfiguration(this.database.db);
    return this.toPublicSettings(configuration);
  }

  async getManagementSettings(
    actor: AccessPrincipal,
  ): Promise<StorefrontSettings> {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    return this.toManagementSettings(
      await this.readConfiguration(this.database.db),
    );
  }

  async updateSettings(
    actor: AccessPrincipal,
    input: StorefrontSettingsUpdate,
  ): Promise<StorefrontSettings> {
    const updated = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        StorefrontPolicy,
        "manageSettings",
        actor,
        transaction,
      );

      const current = await this.readConfiguration(transaction, true);
      if (current.version !== input.expectedVersion) {
        throw new ConflictException(
          "Storefront settings changed since they were loaded. Refresh and try again.",
          { errorCode: "STOREFRONT_SETTINGS_STALE" },
        );
      }

      const nextFooterLinkGroups = StorefrontFooterLinkGroupsSchema.parse(
        input.footerLinkGroups ?? {
          about: input.footerLinks ?? [],
          policies: current.footerLinkGroups.policies,
        },
      );
      const nextFooterCategoryIds =
        input.footerCategoryIds ?? current.footerCategoryIds;
      const nextHomepageCategoriesEnabled =
        input.homepageCategoriesEnabled ?? current.homepageCategoriesEnabled;
      const nextHomepageCategoryIds =
        input.homepageCategoryIds &&
        sameCategoryIds(current.homepageCategoryIds, input.homepageCategoryIds)
          ? current.homepageCategoryIds
          : (input.homepageCategoryIds ?? current.homepageCategoryIds);
      const nextLinkedinUrl =
        input.socialLinks.linkedin === undefined
          ? current.linkedinUrl
          : input.socialLinks.linkedin;
      const previouslyConfiguredCategoryIds = new Set([
        ...current.headerNavigation.flatMap((item) =>
          item.type === "category" ? [item.categoryId] : [],
        ),
        ...current.footerCategoryIds,
        ...current.homepageCategoryIds,
      ]);
      const requestedCategoryIds = [
        ...input.headerNavigation.flatMap((item) =>
          item.type === "category" ? [item.categoryId] : [],
        ),
        ...nextFooterCategoryIds,
        ...nextHomepageCategoryIds,
      ];
      const newCategoryIds = [
        ...new Set(
          requestedCategoryIds.filter(
            (categoryId) => !previouslyConfiguredCategoryIds.has(categoryId),
          ),
        ),
      ];
      const activeCategoryIds = await this.categories.findActiveIds(
        newCategoryIds,
        transaction,
      );
      if (activeCategoryIds.size !== newCategoryIds.length) {
        throw new BadRequestException(
          "Choose active catalog categories for storefront navigation.",
        );
      }

      const storedSocialLinks = {
        instagram: input.socialLinks.instagram,
        facebook: input.socialLinks.facebook,
        tiktok: input.socialLinks.tiktok,
        youtube: input.socialLinks.youtube,
        x: input.socialLinks.x,
      };
      const currentSocialLinks = {
        ...current.socialLinks,
        linkedin: current.linkedinUrl,
      };
      const nextSocialLinks = {
        ...storedSocialLinks,
        linkedin: nextLinkedinUrl,
      };
      const legacyFooterLinks = [
        ...nextFooterLinkGroups.about,
        ...nextFooterLinkGroups.policies,
      ].slice(0, 8);

      const changedFields = [
        ...(current.siteName !== input.siteName ? ["siteName"] : []),
        ...(current.brandColor !== input.brandColor ? ["brandColor"] : []),
        ...(current.backgroundColor !== input.backgroundColor
          ? ["backgroundColor"]
          : []),
        ...(current.seoTitle !== input.seoTitle ? ["seoTitle"] : []),
        ...(current.seoDescription !== input.seoDescription
          ? ["seoDescription"]
          : []),
        ...(current.socialImageAlt !== input.socialImageAlt
          ? ["socialImageAlt"]
          : []),
        ...(current.announcementEnabled !== input.announcementEnabled
          ? ["announcementEnabled"]
          : []),
        ...(current.announcementText !== input.announcementText
          ? ["announcementText"]
          : []),
        ...(current.supportPhone !== input.supportPhone
          ? ["supportPhone"]
          : []),
        ...(current.supportEmail !== input.supportEmail
          ? ["supportEmail"]
          : []),
        ...(current.businessAddress !== input.businessAddress
          ? ["businessAddress"]
          : []),
        ...(JSON.stringify(currentSocialLinks) !==
        JSON.stringify(nextSocialLinks)
          ? ["socialLinks"]
          : []),
        ...(JSON.stringify(current.headerNavigation) !==
        JSON.stringify(input.headerNavigation)
          ? ["headerNavigation"]
          : []),
        ...(current.footerDescription !== input.footerDescription
          ? ["footerDescription"]
          : []),
        ...(JSON.stringify(current.footerLinkGroups) !==
        JSON.stringify(nextFooterLinkGroups)
          ? ["footerLinkGroups"]
          : []),
        ...(JSON.stringify(current.footerCategoryIds) !==
        JSON.stringify(nextFooterCategoryIds)
          ? ["footerCategoryIds"]
          : []),
        ...(current.homepageCategoriesEnabled !== nextHomepageCategoriesEnabled
          ? ["homepageCategoriesEnabled"]
          : []),
        ...(!sameCategoryIds(
          current.homepageCategoryIds,
          nextHomepageCategoryIds,
        )
          ? ["homepageCategoryIds"]
          : []),
      ];
      if (changedFields.length === 0) return current;

      const [next] = await transaction
        .update(storefrontConfiguration)
        .set({
          siteName: input.siteName,
          brandColor: input.brandColor,
          backgroundColor: input.backgroundColor,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          socialImageAlt: input.socialImageAlt,
          announcementEnabled: input.announcementEnabled,
          announcementText: input.announcementText,
          supportPhone: input.supportPhone,
          supportEmail: input.supportEmail,
          businessAddress: input.businessAddress,
          socialLinks: storedSocialLinks,
          linkedinUrl: nextLinkedinUrl,
          headerNavigation: input.headerNavigation,
          footerDescription: input.footerDescription,
          footerLinks: legacyFooterLinks,
          footerLinkGroups: nextFooterLinkGroups,
          footerCategoryIds: nextFooterCategoryIds,
          homepageCategoriesEnabled: nextHomepageCategoriesEnabled,
          homepageCategoryIds: nextHomepageCategoryIds,
          version: current.version + 1,
          updatedAt: sql`now()`,
          updatedBy: actor.id,
        })
        .where(eq(storefrontConfiguration.id, "default"))
        .returning();
      if (!next) throw storefrontConfigurationUnavailable();

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "storefront.settings_updated",
        subjectType: "storefront_configuration",
        subjectId: "default",
        reason: input.reason,
        metadata: {
          previousVersion: current.version,
          version: next.version,
          changedFields,
        },
      });
      return next;
    });

    return this.toManagementSettings(updated);
  }

  private async readConfiguration(
    database: DatabaseService["db"] | AuditTransaction,
    lock = false,
  ) {
    const query = database
      .select()
      .from(storefrontConfiguration)
      .where(eq(storefrontConfiguration.id, "default"));
    const [configuration] = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    if (!configuration) throw storefrontConfigurationUnavailable();
    return configuration;
  }

  private async toManagementSettings(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ): Promise<StorefrontSettings> {
    const publicFields = await this.publicSettingsFields(configuration);
    return StorefrontSettingsSchema.parse({
      ...publicFields,
      headerNavigation: this.validHeaderNavigation(configuration),
      version: configuration.version,
      updatedAt: configuration.updatedAt?.toISOString() ?? null,
    });
  }

  private async toPublicSettings(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ): Promise<PublicStorefrontSettings> {
    const headerConfiguration = this.validHeaderNavigation(configuration);
    const categoryIds = headerConfiguration.map(({ categoryId }) => categoryId);
    const [publicFields, categories] = await Promise.all([
      this.publicSettingsFields(configuration),
      this.categories.findActiveNavigationCategories(categoryIds),
    ]);
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const headerNavigation = headerConfiguration.flatMap(({ categoryId }) => {
      const category = categoriesById.get(categoryId);
      return category
        ? [
            {
              label: category.name,
              href: getStorefrontCategoryHref(category.slug),
            },
          ]
        : [];
    });

    return PublicStorefrontSettingsSchema.parse({
      ...publicFields,
      headerNavigation,
    });
  }

  private validHeaderNavigation(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ) {
    return configuration.headerNavigation.flatMap((item) => {
      const result = StorefrontHeaderNavigationItemSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  }

  private async publicSettingsFields(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ) {
    const assetIds = [
      configuration.logoAssetId,
      configuration.brandIconAssetId,
      configuration.faviconAssetId,
      configuration.socialImageAssetId,
    ].filter((assetId): assetId is string => assetId !== null);
    const assets = assetIds.length
      ? await this.database.db
          .select()
          .from(storefrontBrandAsset)
          .where(inArray(storefrontBrandAsset.id, assetIds))
      : [];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const logo = configuration.logoAssetId
      ? assetsById.get(configuration.logoAssetId)
      : null;
    const brandIcon = configuration.brandIconAssetId
      ? assetsById.get(configuration.brandIconAssetId)
      : null;
    const favicon = configuration.faviconAssetId
      ? assetsById.get(configuration.faviconAssetId)
      : null;
    const socialImage = configuration.socialImageAssetId
      ? assetsById.get(configuration.socialImageAssetId)
      : null;

    return {
      siteName: configuration.siteName,
      brandColor: configuration.brandColor,
      backgroundColor: configuration.backgroundColor,
      seoTitle: configuration.seoTitle,
      seoDescription: configuration.seoDescription,
      announcementEnabled: configuration.announcementEnabled,
      announcementText: configuration.announcementText,
      supportPhone: configuration.supportPhone,
      supportEmail: configuration.supportEmail,
      businessAddress: configuration.businessAddress,
      logo: logo ? toStorefrontBrandAsset(logo) : null,
      brandIcon: brandIcon
        ? StorefrontBrandIconAssetSchema.parse(
            toStorefrontBrandAsset(brandIcon),
          )
        : null,
      favicon: favicon ? toStorefrontBrandAsset(favicon) : null,
      socialImage: socialImage ? toStorefrontBrandAsset(socialImage) : null,
      socialImageAlt: configuration.socialImageAlt,
      socialLinks: {
        ...configuration.socialLinks,
        linkedin: configuration.linkedinUrl,
      },
      footerDescription: configuration.footerDescription,
      footerLinks: configuration.footerLinks,
      footerLinkGroups: configuration.footerLinkGroups,
      footerCategoryIds: configuration.footerCategoryIds,
      homepageCategoriesEnabled: configuration.homepageCategoriesEnabled,
      homepageCategoryIds: configuration.homepageCategoryIds,
    };
  }
}

function sameCategoryIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((categoryId) => right.includes(categoryId))
  );
}

function storefrontConfigurationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Storefront settings are not available.",
    { errorCode: "STOREFRONT_SETTINGS_UNAVAILABLE" },
  );
}

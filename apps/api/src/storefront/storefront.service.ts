import {
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
import { PublicStorefrontSettingsSchema } from "@aaraj/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { StorefrontPolicy } from "./storefront.policy.js";
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

      const changedFields = [
        ...(current.siteName !== input.siteName ? ["siteName"] : []),
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
        ...(JSON.stringify(current.socialLinks) !==
        JSON.stringify(input.socialLinks)
          ? ["socialLinks"]
          : []),
        ...(current.footerDescription !== input.footerDescription
          ? ["footerDescription"]
          : []),
        ...(JSON.stringify(current.footerLinks) !==
        JSON.stringify(input.footerLinks)
          ? ["footerLinks"]
          : []),
      ];
      if (changedFields.length === 0) return current;

      const [next] = await transaction
        .update(storefrontConfiguration)
        .set({
          siteName: input.siteName,
          announcementEnabled: input.announcementEnabled,
          announcementText: input.announcementText,
          supportPhone: input.supportPhone,
          supportEmail: input.supportEmail,
          businessAddress: input.businessAddress,
          socialLinks: input.socialLinks,
          footerDescription: input.footerDescription,
          footerLinks: input.footerLinks,
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

  private toManagementSettings(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ): Promise<StorefrontSettings> {
    return this.toPublicSettings(configuration).then((publicSettings) => ({
      ...publicSettings,
      version: configuration.version,
      updatedAt: configuration.updatedAt?.toISOString() ?? null,
    }));
  }

  private async toPublicSettings(
    configuration: typeof storefrontConfiguration.$inferSelect,
  ): Promise<PublicStorefrontSettings> {
    const assetIds = [
      configuration.logoAssetId,
      configuration.faviconAssetId,
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
    const favicon = configuration.faviconAssetId
      ? assetsById.get(configuration.faviconAssetId)
      : null;

    return PublicStorefrontSettingsSchema.parse({
      siteName: configuration.siteName,
      announcementEnabled: configuration.announcementEnabled,
      announcementText: configuration.announcementText,
      supportPhone: configuration.supportPhone,
      supportEmail: configuration.supportEmail,
      businessAddress: configuration.businessAddress,
      logo: logo ? toStorefrontBrandAsset(logo) : null,
      favicon: favicon ? toStorefrontBrandAsset(favicon) : null,
      socialLinks: configuration.socialLinks,
      footerDescription: configuration.footerDescription,
      footerLinks: configuration.footerLinks,
    });
  }
}

function storefrontConfigurationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Storefront settings are not available.",
    { errorCode: "STOREFRONT_SETTINGS_UNAVAILABLE" },
  );
}

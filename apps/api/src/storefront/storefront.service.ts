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
import { eq, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import { storefrontConfiguration } from "./storefront-schema.js";

@Injectable()
export class StorefrontSettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async getPublicSettings(): Promise<PublicStorefrontSettings> {
    const configuration = await this.readConfiguration(this.database.db);
    return {
      siteName: configuration.siteName,
      announcementEnabled: configuration.announcementEnabled,
      announcementText: configuration.announcementText,
      supportPhone: configuration.supportPhone,
    };
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
      ];
      if (changedFields.length === 0) return current;

      const [next] = await transaction
        .update(storefrontConfiguration)
        .set({
          siteName: input.siteName,
          announcementEnabled: input.announcementEnabled,
          announcementText: input.announcementText,
          supportPhone: input.supportPhone,
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
  ): StorefrontSettings {
    return {
      siteName: configuration.siteName,
      announcementEnabled: configuration.announcementEnabled,
      announcementText: configuration.announcementText,
      supportPhone: configuration.supportPhone,
      version: configuration.version,
      updatedAt: configuration.updatedAt?.toISOString() ?? null,
    };
  }
}

function storefrontConfigurationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Storefront settings are not available.",
    { errorCode: "STOREFRONT_SETTINGS_UNAVAILABLE" },
  );
}

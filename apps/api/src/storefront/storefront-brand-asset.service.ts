import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import {
  type StorefrontBrandAssetClear,
  type StorefrontBrandAssetKind,
  type StorefrontBrandAssetUpload,
} from "@aaraj/contracts";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { R2Storage } from "../platform/storage/r2-storage.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import {
  storefrontBrandAsset,
  storefrontConfiguration,
} from "./storefront-schema.js";
import { StorefrontSettingsService } from "./storefront.service.js";
import {
  processStorefrontBrandIcon,
  processStorefrontBrandImage,
  type StorefrontBrandUploadFile,
} from "./storefront-brand-image.js";

@Injectable()
export class StorefrontBrandAssetService {
  private readonly logger = new Logger(StorefrontBrandAssetService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly storage: R2Storage,
    private readonly settings: StorefrontSettingsService,
  ) {}

  async upload(
    actor: AccessPrincipal,
    kind: StorefrontBrandAssetKind,
    input: StorefrontBrandAssetUpload,
    file: StorefrontBrandUploadFile | undefined,
  ) {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException("Choose one image file to upload.");
    }
    const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");

    const [existingCommand] = await this.database.db
      .select()
      .from(storefrontBrandAsset)
      .where(eq(storefrontBrandAsset.commandId, input.commandId))
      .limit(1);
    if (existingCommand) {
      if (
        existingCommand.kind !== kind ||
        existingCommand.sourceSha256 !== sourceSha256
      ) {
        throw new ConflictException(
          "This upload command was already used for different content.",
        );
      }
      return this.settings.getManagementSettings(actor);
    }

    const processed = await processStorefrontBrandImage(file, kind);
    const sha256 = createHash("sha256").update(processed.body).digest("hex");
    const id = randomUUID();
    const extension =
      kind === "favicon" || kind === "brandIcon"
        ? "png"
        : kind === "socialImage"
          ? "jpg"
          : "webp";
    const objectKey = `published/storefront/${kind}/${id}/${sha256}.${extension}`;

    let assetCommitted = false;
    try {
      await this.storage.putPublishedObject({
        key: objectKey,
        body: processed.body,
        contentType: processed.contentType,
        sha256,
      });
    } catch (error) {
      this.logStorageFailure("put", id, error);
      throw storefrontAssetStorageUnavailable();
    }

    try {
      const result = await this.database.db.transaction(async (transaction) => {
        await this.authorization.authorize(
          StorefrontPolicy,
          "manageSettings",
          actor,
          transaction,
        );
        const current = await this.readConfiguration(transaction, true);
        const [racedCommand] = await transaction
          .select()
          .from(storefrontBrandAsset)
          .where(eq(storefrontBrandAsset.commandId, input.commandId))
          .limit(1);
        if (racedCommand) {
          if (
            racedCommand.kind !== kind ||
            racedCommand.sourceSha256 !== sourceSha256
          ) {
            throw new ConflictException(
              "This upload command was already used for different content.",
            );
          }
          return { duplicate: true as const };
        }
        if (current.version !== input.expectedVersion) {
          throw new ConflictException(
            "Storefront settings changed since they were loaded. Refresh and try again.",
            { errorCode: "STOREFRONT_SETTINGS_STALE" },
          );
        }

        await transaction.insert(storefrontBrandAsset).values({
          id,
          commandId: input.commandId,
          kind,
          objectKey,
          contentType: processed.contentType,
          sizeBytes: processed.body.byteLength,
          sourceSha256,
          sha256,
          width: processed.width,
          height: processed.height,
          createdBy: actor.id,
        });

        const assetPointer = assetPointerFor(kind, id);
        const [next] = await transaction
          .update(storefrontConfiguration)
          .set({
            ...assetPointer,
            version: current.version + 1,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(storefrontConfiguration.id, "default"))
          .returning();
        if (!next) throw storefrontConfigurationUnavailable();

        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "storefront.brand_asset_updated",
          subjectType: "storefront_configuration",
          subjectId: "default",
          reason: input.reason,
          metadata: {
            previousVersion: current.version,
            version: next.version,
            changedFields: [kind],
          },
        });
        return { duplicate: false as const };
      });

      if (result.duplicate) {
        await this.deleteUploadedObject(objectKey, id);
      } else {
        assetCommitted = true;
      }
      return this.settings.getManagementSettings(actor);
    } catch (error) {
      if (!assetCommitted) await this.deleteUploadedObject(objectKey, id);
      throw error;
    }
  }

  async clear(
    actor: AccessPrincipal,
    kind: StorefrontBrandAssetKind,
    input: StorefrontBrandAssetClear,
  ) {
    await this.database.db.transaction(async (transaction) => {
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
      const currentAssetId = assetIdFor(current, kind);
      if (!currentAssetId) return;

      const assetPointer = assetPointerFor(kind, null);
      const [next] = await transaction
        .update(storefrontConfiguration)
        .set({
          ...assetPointer,
          version: current.version + 1,
          updatedAt: new Date(),
          updatedBy: actor.id,
        })
        .where(eq(storefrontConfiguration.id, "default"))
        .returning();
      if (!next) throw storefrontConfigurationUnavailable();
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "storefront.brand_asset_cleared",
        subjectType: "storefront_configuration",
        subjectId: "default",
        reason: input.reason,
        metadata: {
          previousVersion: current.version,
          version: next.version,
          changedFields: [kind],
        },
      });
    });
    return this.settings.getManagementSettings(actor);
  }

  async getPublicAsset(
    assetId: string,
    sha256: string,
    extension: "png" | "webp" | "jpg",
  ): Promise<{
    body: Buffer;
    contentType: "image/png" | "image/webp" | "image/jpeg";
  }> {
    const [row] = await this.database.db
      .select({ asset: storefrontBrandAsset })
      .from(storefrontBrandAsset)
      .innerJoin(
        storefrontConfiguration,
        or(
          eq(storefrontConfiguration.logoAssetId, storefrontBrandAsset.id),
          eq(storefrontConfiguration.brandIconAssetId, storefrontBrandAsset.id),
          eq(storefrontConfiguration.faviconAssetId, storefrontBrandAsset.id),
          eq(
            storefrontConfiguration.socialImageAssetId,
            storefrontBrandAsset.id,
          ),
        ),
      )
      .where(
        and(
          eq(storefrontBrandAsset.id, assetId),
          eq(storefrontBrandAsset.sha256, sha256),
          eq(
            storefrontBrandAsset.contentType,
            extension === "png"
              ? "image/png"
              : extension === "jpg"
                ? "image/jpeg"
                : "image/webp",
          ),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Storefront image not found.");

    try {
      const body = await this.storage.getPublishedObject({
        key: row.asset.objectKey,
        sha256: row.asset.sha256,
        sizeBytes: row.asset.sizeBytes,
      });
      return {
        body,
        contentType: row.asset.contentType as
          "image/png" | "image/webp" | "image/jpeg",
      };
    } catch (error) {
      this.logStorageFailure("get", assetId, error);
      throw storefrontAssetStorageUnavailable();
    }
  }

  async getPublicAssetAsPng(
    assetId: string,
    sha256: string,
    extension: "png" | "webp" | "jpg",
  ): Promise<{ body: Buffer; contentType: "image/png" }> {
    const asset = await this.getPublicAsset(assetId, sha256, extension);
    return {
      body: await processStorefrontBrandIcon(asset.body),
      contentType: "image/png",
    };
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

  private async deleteUploadedObject(objectKey: string, assetId: string) {
    try {
      await this.storage.deleteObjects([objectKey]);
    } catch (error) {
      this.logStorageFailure("delete", assetId, error);
    }
  }

  private logStorageFailure(
    operation: string,
    assetId: string,
    error: unknown,
  ) {
    this.logger.error("Storefront brand asset storage request failed", {
      event: "storefront.brand_asset_storage_failed",
      operation,
      assetId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}

function assetIdFor(
  configuration: typeof storefrontConfiguration.$inferSelect,
  kind: StorefrontBrandAssetKind,
) {
  switch (kind) {
    case "logo":
      return configuration.logoAssetId;
    case "brandIcon":
      return configuration.brandIconAssetId;
    case "favicon":
      return configuration.faviconAssetId;
    case "socialImage":
      return configuration.socialImageAssetId;
  }
}

function assetPointerFor(
  kind: StorefrontBrandAssetKind,
  assetId: string | null,
) {
  switch (kind) {
    case "logo":
      return { logoAssetId: assetId };
    case "brandIcon":
      return { brandIconAssetId: assetId };
    case "favicon":
      return { faviconAssetId: assetId };
    case "socialImage":
      return { socialImageAssetId: assetId };
  }
}

function storefrontConfigurationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Storefront settings are not available.",
    { errorCode: "STOREFRONT_SETTINGS_UNAVAILABLE" },
  );
}

function storefrontAssetStorageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: "Storefront media storage is temporarily unavailable.",
    errorCode: "STOREFRONT_ASSET_STORAGE_UNAVAILABLE",
  });
}

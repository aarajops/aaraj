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
  API_V1_BASE_PATH,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_OFFSET,
  type PublicStorefrontBanners,
  type ManagedStorefrontBannerAsset,
  type StorefrontBanner,
  type StorefrontBannerAssetPage,
  type StorefrontBannerAssetUpload,
  type StorefrontBannerCreate,
  type StorefrontBannerListQuery,
  type StorefrontBannerPage,
  type StorefrontBannerPlacement,
  type StorefrontBannerUpdate,
} from "@aaraj/contracts";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { R2Storage } from "../platform/storage/r2-storage.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import {
  storefrontBanner,
  storefrontBannerAsset,
} from "./storefront-schema.js";
import {
  processStorefrontBannerImage,
  type StorefrontBannerUploadFile,
} from "./storefront-banner-image.js";

const ASSET_LIST_LIMIT = DEFAULT_LIST_PAGE_SIZE;
const ASSET_QUERY_LIMIT = ASSET_LIST_LIMIT + 1;
const desktopAssetTable = alias(storefrontBannerAsset, "desktop_banner_asset");
const mobileAssetTable = alias(storefrontBannerAsset, "mobile_banner_asset");

@Injectable()
export class StorefrontBannersService {
  private readonly logger = new Logger(StorefrontBannersService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly storage: R2Storage,
  ) {}

  async getPublic(
    placement: StorefrontBannerPlacement,
  ): Promise<PublicStorefrontBanners> {
    const rows = await this.database.db
      .select({
        banner: storefrontBanner,
        desktop: desktopAssetTable,
        mobile: mobileAssetTable,
      })
      .from(storefrontBanner)
      .innerJoin(
        desktopAssetTable,
        eq(desktopAssetTable.id, storefrontBanner.desktopAssetId),
      )
      .leftJoin(
        mobileAssetTable,
        eq(mobileAssetTable.id, storefrontBanner.mobileAssetId),
      )
      .where(
        and(
          eq(storefrontBanner.placement, placement),
          eq(storefrontBanner.active, true),
        ),
      )
      .orderBy(desc(storefrontBanner.createdAt), desc(storefrontBanner.id));
    return {
      placement,
      banners: rows.map(({ banner, desktop, mobile }) => ({
        desktop: toAsset(desktop),
        mobile: mobile ? toAsset(mobile) : null,
        altText: banner.altText,
        href: banner.href,
      })),
    };
  }

  async getPublicAsset(assetId: string, sha256: string) {
    const [asset] = await this.database.db
      .select({ asset: storefrontBannerAsset })
      .from(storefrontBannerAsset)
      .where(
        and(
          eq(storefrontBannerAsset.id, assetId),
          eq(storefrontBannerAsset.sha256, sha256),
          isNotNull(storefrontBannerAsset.publiclyReleasedAt),
        ),
      )
      .limit(1);
    if (!asset) throw new NotFoundException("Storefront banner not found.");
    return this.readAsset(asset.asset);
  }

  async getManagedAsset(
    actor: AccessPrincipal,
    assetId: string,
    sha256: string,
  ) {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    const [asset] = await this.database.db
      .select()
      .from(storefrontBannerAsset)
      .where(
        and(
          eq(storefrontBannerAsset.id, assetId),
          eq(storefrontBannerAsset.sha256, sha256),
        ),
      )
      .limit(1);
    if (!asset) throw new NotFoundException("Storefront banner not found.");
    return this.readAsset(asset);
  }

  private async readAsset(asset: typeof storefrontBannerAsset.$inferSelect) {
    try {
      const body = await this.storage.getPublishedObject({
        key: asset.objectKey,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
      });
      return { body, contentType: "image/webp" as const };
    } catch (error) {
      this.logStorageFailure("get", asset.id, error, asset.objectKey);
      throw storefrontBannerStorageUnavailable();
    }
  }

  async listForManagement(
    actor: AccessPrincipal,
    query: StorefrontBannerListQuery,
  ): Promise<StorefrontBannerPage> {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    const conditions = [];
    if (query.search) {
      const pattern = `%${escapeLikeWildcards(query.search)}%`;
      const searchCondition = or(
        ilike(storefrontBanner.name, pattern),
        ilike(storefrontBanner.altText, pattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (query.status) {
      conditions.push(eq(storefrontBanner.active, query.status === "active"));
    }
    const rows = await this.database.db
      .select({
        banner: storefrontBanner,
        desktop: desktopAssetTable,
        mobile: mobileAssetTable,
      })
      .from(storefrontBanner)
      .leftJoin(
        desktopAssetTable,
        eq(desktopAssetTable.id, storefrontBanner.desktopAssetId),
      )
      .leftJoin(
        mobileAssetTable,
        eq(mobileAssetTable.id, storefrontBanner.mobileAssetId),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(storefrontBanner.createdAt), desc(storefrontBanner.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const candidateNextOffset = query.offset + selected.length;
    const nextOffset =
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null;
    return {
      banners: selected.map(({ banner, desktop, mobile }) =>
        toManagedBanner(banner, desktop, mobile),
      ),
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset,
    };
  }

  async getForManagement(
    actor: AccessPrincipal,
    bannerId: string,
  ): Promise<StorefrontBanner> {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    const [row] = await this.database.db
      .select({
        banner: storefrontBanner,
        desktop: desktopAssetTable,
        mobile: mobileAssetTable,
      })
      .from(storefrontBanner)
      .leftJoin(
        desktopAssetTable,
        eq(desktopAssetTable.id, storefrontBanner.desktopAssetId),
      )
      .leftJoin(
        mobileAssetTable,
        eq(mobileAssetTable.id, storefrontBanner.mobileAssetId),
      )
      .where(eq(storefrontBanner.id, bannerId))
      .limit(1);
    if (!row) throw new NotFoundException("Storefront banner not found.");
    return toManagedBanner(row.banner, row.desktop, row.mobile);
  }

  async getAssetPage(
    actor: AccessPrincipal,
    cursor?: string,
  ): Promise<StorefrontBannerAssetPage> {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    return this.readAssetPage(cursor);
  }

  async upload(
    actor: AccessPrincipal,
    input: StorefrontBannerAssetUpload,
    file: StorefrontBannerUploadFile | undefined,
  ): Promise<ManagedStorefrontBannerAsset> {
    await this.authorization.authorize(
      StorefrontPolicy,
      "manageSettings",
      actor,
    );
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException("Choose one image file to upload.");
    }
    const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");
    const [existing] = await this.database.db
      .select()
      .from(storefrontBannerAsset)
      .where(eq(storefrontBannerAsset.commandId, input.commandId))
      .limit(1);
    if (existing) {
      if (existing.sourceSha256 !== sourceSha256) {
        throw new ConflictException(
          "This upload command was already used for different content.",
        );
      }
      return toManagedAsset(existing);
    }

    const processed = await processStorefrontBannerImage(file);
    const sha256 = createHash("sha256").update(processed.body).digest("hex");
    const id = randomUUID();
    const objectKey = `published/storefront/banner/${id}/${sha256}.webp`;
    let savedAssetId: string = id;
    try {
      await this.storage.putPublishedObject({
        key: objectKey,
        body: processed.body,
        contentType: "image/webp",
        sha256,
      });
    } catch (error) {
      this.logStorageFailure("put", id, error, objectKey);
      throw storefrontBannerStorageUnavailable();
    }

    try {
      const inserted = await this.database.db.transaction(
        async (transaction) => {
          await this.authorization.authorize(
            StorefrontPolicy,
            "manageSettings",
            actor,
            transaction,
          );
          const [raced] = await transaction
            .select()
            .from(storefrontBannerAsset)
            .where(eq(storefrontBannerAsset.commandId, input.commandId))
            .limit(1);
          if (raced) {
            if (raced.sourceSha256 !== sourceSha256) {
              throw new ConflictException(
                "This upload command was already used for different content.",
              );
            }
            savedAssetId = raced.id;
            return false;
          }
          const [created] = await transaction
            .insert(storefrontBannerAsset)
            .values({
              id,
              commandId: input.commandId,
              objectKey,
              sizeBytes: processed.body.byteLength,
              sourceSha256,
              sha256,
              width: processed.width,
              height: processed.height,
              createdBy: actor.id,
            })
            .onConflictDoNothing({
              target: storefrontBannerAsset.commandId,
            })
            .returning({ id: storefrontBannerAsset.id });
          if (!created) {
            const [raced] = await transaction
              .select()
              .from(storefrontBannerAsset)
              .where(eq(storefrontBannerAsset.commandId, input.commandId))
              .limit(1);
            if (!raced) throw storefrontBannerUnavailable();
            if (raced.sourceSha256 !== sourceSha256) {
              throw new ConflictException(
                "This upload command was already used for different content.",
              );
            }
            savedAssetId = raced.id;
            return false;
          }
          await this.audit.append(transaction, {
            actorType: "user",
            actorId: actor.id,
            eventType: "storefront.banner_asset_uploaded",
            subjectType: "storefront_banner_asset",
            subjectId: id,
            metadata: { width: processed.width, height: processed.height },
          });
          return true;
        },
      );
      if (!inserted) await this.deleteUploadedObject(objectKey, id);
    } catch (error) {
      await this.deleteUploadedObject(objectKey, id);
      throw error;
    }

    const [saved] = await this.database.db
      .select()
      .from(storefrontBannerAsset)
      .where(eq(storefrontBannerAsset.id, savedAssetId))
      .limit(1);
    if (!saved) throw storefrontBannerUnavailable();
    return toManagedAsset(saved);
  }

  async create(
    actor: AccessPrincipal,
    input: StorefrontBannerCreate,
  ): Promise<StorefrontBanner> {
    const id = randomUUID();
    await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        StorefrontPolicy,
        "manageSettings",
        actor,
        transaction,
      );
      const assetIds = [input.desktopAssetId, input.mobileAssetId].filter(
        (assetId): assetId is string => assetId !== null,
      );
      if (assetIds.length) {
        const assets = await transaction
          .select({ id: storefrontBannerAsset.id })
          .from(storefrontBannerAsset)
          .where(inArray(storefrontBannerAsset.id, assetIds));
        if (assets.length !== new Set(assetIds).size) {
          throw new BadRequestException("Choose uploaded banner images.");
        }
      }
      await transaction.insert(storefrontBanner).values({
        id,
        ...input,
        createdBy: actor.id,
        updatedAt: new Date(),
        updatedBy: actor.id,
      });
      if (input.active && assetIds.length) {
        await transaction
          .update(storefrontBannerAsset)
          .set({
            publiclyReleasedAt: sql`coalesce(${storefrontBannerAsset.publiclyReleasedAt}, now())`,
          })
          .where(inArray(storefrontBannerAsset.id, assetIds));
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "storefront.banner_created",
        subjectType: "storefront_banner",
        subjectId: id,
        metadata: {
          name: input.name,
          placement: input.placement,
          active: input.active,
          desktopAssetId: input.desktopAssetId,
          mobileAssetId: input.mobileAssetId,
        },
      });
    });
    return this.getForManagement(actor, id);
  }

  async update(
    actor: AccessPrincipal,
    bannerId: string,
    input: StorefrontBannerUpdate,
  ): Promise<StorefrontBanner> {
    await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        StorefrontPolicy,
        "manageSettings",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(storefrontBanner)
        .where(eq(storefrontBanner.id, bannerId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Storefront banner not found.");
      if (current.version !== input.expectedVersion) {
        throw new ConflictException(
          "This banner changed since it was loaded. Refresh and try again.",
          { errorCode: "STOREFRONT_BANNER_STALE" },
        );
      }
      const assetIds = [input.desktopAssetId, input.mobileAssetId].filter(
        (assetId): assetId is string => assetId !== null,
      );
      if (assetIds.length) {
        const assets = await transaction
          .select({ id: storefrontBannerAsset.id })
          .from(storefrontBannerAsset)
          .where(inArray(storefrontBannerAsset.id, assetIds));
        if (assets.length !== new Set(assetIds).size) {
          throw new BadRequestException("Choose uploaded banner images.");
        }
      }
      const [next] = await transaction
        .update(storefrontBanner)
        .set({
          name: input.name,
          placement: input.placement,
          active: input.active,
          desktopAssetId: input.desktopAssetId,
          mobileAssetId: input.mobileAssetId,
          altText: input.altText,
          href: input.href,
          version: current.version + 1,
          updatedAt: new Date(),
          updatedBy: actor.id,
        })
        .where(
          and(
            eq(storefrontBanner.id, bannerId),
            eq(storefrontBanner.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!next) {
        throw new ConflictException(
          "This banner changed since it was loaded. Refresh and try again.",
          { errorCode: "STOREFRONT_BANNER_STALE" },
        );
      }
      if (input.active && assetIds.length) {
        await transaction
          .update(storefrontBannerAsset)
          .set({
            publiclyReleasedAt: sql`coalesce(${storefrontBannerAsset.publiclyReleasedAt}, now())`,
          })
          .where(inArray(storefrontBannerAsset.id, assetIds));
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "storefront.banner_updated",
        subjectType: "storefront_banner",
        subjectId: bannerId,
        metadata: {
          previousVersion: current.version,
          version: next.version,
          active: next.active,
          desktopAssetId: next.desktopAssetId,
          mobileAssetId: next.mobileAssetId,
        },
      });
    });
    return this.getForManagement(actor, bannerId);
  }

  private async deleteUploadedObject(key: string, assetId: string) {
    try {
      await this.storage.deleteObjects([key]);
    } catch (error) {
      this.logStorageFailure("delete", assetId, error, key);
    }
  }

  private async readAssetPage(
    cursor?: string,
  ): Promise<StorefrontBannerAssetPage> {
    const query = this.database.db.select().from(storefrontBannerAsset);
    const rows = cursor
      ? await query
          .where(
            sql`EXISTS (
              SELECT 1
              FROM "storefront"."banner_asset" AS "asset_cursor"
              WHERE "asset_cursor"."id" = ${cursor}
                AND (${storefrontBannerAsset.createdAt}, ${storefrontBannerAsset.id})
                  < ("asset_cursor"."created_at", "asset_cursor"."id")
            )`,
          )
          .orderBy(
            desc(storefrontBannerAsset.createdAt),
            desc(storefrontBannerAsset.id),
          )
          .limit(ASSET_QUERY_LIMIT)
      : await query
          .orderBy(
            desc(storefrontBannerAsset.createdAt),
            desc(storefrontBannerAsset.id),
          )
          .limit(ASSET_QUERY_LIMIT);
    const hasMore = rows.length > ASSET_LIST_LIMIT;
    const page = rows.slice(0, ASSET_LIST_LIMIT);
    const lastAsset = page.at(-1);
    return {
      assets: page.map(toManagedAsset),
      nextCursor: hasMore && lastAsset ? lastAsset.id : null,
    };
  }

  private logStorageFailure(
    operation: string,
    assetId: string,
    error: unknown,
    objectKey?: string,
  ) {
    this.logger.error("Storefront banner storage request failed", {
      event: "storefront.banner_storage_failed",
      operation,
      assetId,
      ...(objectKey ? { objectKey } : {}),
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}

function toManagedBanner(
  banner: typeof storefrontBanner.$inferSelect,
  desktop: typeof storefrontBannerAsset.$inferSelect | null,
  mobile: typeof storefrontBannerAsset.$inferSelect | null,
): StorefrontBanner {
  return {
    id: banner.id,
    name: banner.name,
    placement: banner.placement as StorefrontBannerPlacement,
    active: banner.active,
    desktop: desktop ? toManagedAsset(desktop) : null,
    mobile: mobile ? toManagedAsset(mobile) : null,
    altText: banner.altText,
    href: banner.href,
    version: banner.version,
    createdAt: banner.createdAt.toISOString(),
    updatedAt: banner.updatedAt?.toISOString() ?? null,
  };
}

function toAsset(
  asset: typeof storefrontBannerAsset.$inferSelect,
): PublicStorefrontBanners["banners"][number]["desktop"] {
  return {
    id: asset.id,
    src: `${API_V1_BASE_PATH}/storefront/banner-assets/${asset.id}/${asset.sha256}.webp`,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
  };
}

function toManagedAsset(
  asset: typeof storefrontBannerAsset.$inferSelect,
): ManagedStorefrontBannerAsset {
  return {
    id: asset.id,
    src: `${API_V1_BASE_PATH}/storefront/manage/banner-assets/${asset.id}/${asset.sha256}.webp`,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
  };
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function storefrontBannerUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Storefront banner settings are not available.",
    { errorCode: "STOREFRONT_BANNER_UNAVAILABLE" },
  );
}

function storefrontBannerStorageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: "Storefront image storage is temporarily unavailable.",
    errorCode: "STOREFRONT_ASSET_STORAGE_UNAVAILABLE",
  });
}

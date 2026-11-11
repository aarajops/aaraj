import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, not, or, sql } from "drizzle-orm";
import {
  CatalogMediaDerivativesSchema,
  CatalogMediaSchema,
  MAX_CATALOG_PRODUCT_MEDIA,
  type CatalogMediaDerivatives,
  type CatalogMediaRendition,
  type CatalogMedia,
  type CatalogMediaDeleteInput,
  type CatalogProductMediaOrderInput,
  type CatalogMediaUploadInput,
  type CatalogMediaUpdateInput,
  type CatalogProductMediaList,
} from "@aaraj/contracts";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AccessPrincipal } from "../../platform/authorization/permissions.service.js";
import { DatabaseService } from "../../platform/database/database.service.js";
import {
  catalogProduct,
  catalogProductMedia,
  catalogProductVariant,
} from "../catalog-schema.js";
import { CatalogPolicy } from "../catalog.policy.js";
import { validateProductMediaCoverage } from "../catalog.service.js";
import { R2Storage } from "./r2-storage.js";
import { getCurrentRequestId } from "../../platform/request-context.js";
import {
  InvalidCatalogImageError,
  processCatalogImage,
} from "./catalog-image-processor.js";
import {
  validateCatalogImageUpload,
  type CatalogMediaUploadFile,
} from "./catalog-image-upload.js";
export type { CatalogMediaUploadFile } from "./catalog-image-upload.js";

interface UploadRecord {
  id: string;
  commandId: string;
  productId: string;
  variantId: string | null;
  variantColor: string | null;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sourceSha256: string;
  derivatives: CatalogMediaDerivatives;
  altText: string;
  reason: string | null;
  deletionReason: string | null;
  sortOrder: number;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CatalogMediaService {
  private readonly logger = new Logger(CatalogMediaService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly storage: R2Storage,
  ) {}

  async listForManagement(
    actor: AccessPrincipal,
    productId: string,
  ): Promise<CatalogProductMediaList> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const [product] = await this.database.db
      .select({ id: catalogProduct.id })
      .from(catalogProduct)
      .where(eq(catalogProduct.id, productId))
      .limit(1);
    if (!product) throw new NotFoundException("Product not found.");

    const rows = await this.database.db
      .select()
      .from(catalogProductMedia)
      .where(
        and(
          eq(catalogProductMedia.productId, productId),
          not(eq(catalogProductMedia.status, "deleted")),
        ),
      )
      .orderBy(asc(catalogProductMedia.sortOrder));
    return { media: rows.map(toCatalogMedia) };
  }

  async reorder(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogProductMediaOrderInput,
  ): Promise<CatalogProductMediaList> {
    const media = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );

      const [product] = await transaction
        .select({ id: catalogProduct.id })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundException("Product not found.");

      const existingRows = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.productId, productId))
        .orderBy(
          asc(catalogProductMedia.sortOrder),
          asc(catalogProductMedia.id),
        )
        .for("update");
      const reorderableRows = existingRows.filter(
        ({ status }) => status !== "deleted",
      );
      const currentIds = reorderableRows.map(({ id }) => id);
      if (
        currentIds.length !== input.mediaIds.length ||
        input.mediaIds.some((id) => !currentIds.includes(id))
      ) {
        throw new ConflictException(
          "Product images changed. Refresh the list and try again.",
        );
      }

      if (input.mediaIds.every((id, index) => id === currentIds[index])) {
        return reorderableRows;
      }

      const temporaryOffset =
        Math.max(...existingRows.map(({ sortOrder }) => sortOrder)) + 1;
      const updatedAt = new Date();
      await transaction
        .update(catalogProductMedia)
        .set({
          sortOrder: sql`${catalogProductMedia.sortOrder} + ${temporaryOffset}`,
          updatedAt,
        })
        .where(
          and(
            eq(catalogProductMedia.productId, productId),
            not(eq(catalogProductMedia.status, "deleted")),
          ),
        );

      const availableOrders = reorderableRows.map(({ sortOrder }) => sortOrder);
      const sortOrderCases = sql.join(
        input.mediaIds.map((mediaId, index) => {
          const sortOrder = availableOrders[index];
          if (sortOrder === undefined) {
            throw new Error("A product media order is missing its sort slot.");
          }
          return sql`when ${catalogProductMedia.id} = ${mediaId} then ${sortOrder}`;
        }),
        sql` `,
      );
      await transaction
        .update(catalogProductMedia)
        .set({
          sortOrder: sql`case ${sortOrderCases} else ${catalogProductMedia.sortOrder} end`,
          updatedAt,
        })
        .where(
          and(
            eq(catalogProductMedia.productId, productId),
            not(eq(catalogProductMedia.status, "deleted")),
          ),
        );

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_reordered",
        subjectType: "catalog_product",
        subjectId: productId,
        metadata: { mediaIds: input.mediaIds },
      });

      return transaction
        .select()
        .from(catalogProductMedia)
        .where(
          and(
            eq(catalogProductMedia.productId, productId),
            not(eq(catalogProductMedia.status, "deleted")),
          ),
        )
        .orderBy(
          asc(catalogProductMedia.sortOrder),
          asc(catalogProductMedia.id),
        );
    });

    return { media: media.map(toCatalogMedia) };
  }

  async upload(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogMediaUploadInput,
    file: CatalogMediaUploadFile | undefined,
  ): Promise<CatalogMedia> {
    const image = await validateCatalogImageUpload(file);
    const sourceSha256 = createHash("sha256")
      .update(image.buffer)
      .digest("hex");
    const variantId = input.variantId || null;
    const requestedVariantColor = input.variantColor || null;
    if (variantId && requestedVariantColor) {
      throw new BadRequestException(
        "Choose either one exact SKU or a product color for this image.",
      );
    }

    const record = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );

      const [existing] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.commandId, input.commandId))
        .for("update")
        .limit(1);
      if (existing) {
        assertSameUpload(existing, {
          productId,
          variantId,
          variantColor: requestedVariantColor,
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          ...(input.reason ? { reason: input.reason } : {}),
        });
        if (existing.status === "ready" || existing.status === "rejected") {
          return existing;
        }
        if (existing.status === "deleting" || existing.status === "deleted") {
          throw new ConflictException(
            "This upload command has already been removed.",
          );
        }
        return existing;
      }

      const [product] = await transaction
        .select({ id: catalogProduct.id })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundException("Product not found.");

      const [mediaCount] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(catalogProductMedia)
        .where(
          and(
            eq(catalogProductMedia.productId, productId),
            not(eq(catalogProductMedia.status, "deleted")),
          ),
        );
      if ((mediaCount?.count ?? 0) >= MAX_CATALOG_PRODUCT_MEDIA) {
        throw new ConflictException(
          `A product can have at most ${MAX_CATALOG_PRODUCT_MEDIA} images.`,
        );
      }

      let variantColor = requestedVariantColor;
      if (variantId) {
        const [variant] = await transaction
          .select({
            id: catalogProductVariant.id,
            color: catalogProductVariant.color,
          })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.id, variantId),
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
            ),
          )
          .limit(1);
        if (!variant)
          throw new BadRequestException(
            "Select an active SKU that belongs to this product.",
          );
        variantColor = variant.color;
      } else if (requestedVariantColor) {
        const [variant] = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
              sql`lower(btrim(${catalogProductVariant.color})) = lower(btrim(${requestedVariantColor}))`,
            ),
          )
          .limit(1);
        if (!variant) {
          throw new BadRequestException(
            "Select a color used by an active product variant.",
          );
        }
        variantColor = variant.color;
      }

      const [order] = await transaction
        .select({
          next: sql<number>`coalesce(max(${catalogProductMedia.sortOrder}), -1) + 1`,
        })
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.productId, productId));
      const id = randomUUID();
      const now = new Date();
      const [created] = await transaction
        .insert(catalogProductMedia)
        .values({
          id,
          commandId: input.commandId,
          productId,
          variantId,
          variantColor,
          objectKey: quarantineObjectKey(id),
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          reason: input.reason ?? null,
          sortOrder: order?.next ?? 0,
          status: "uploading",
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: catalogProductMedia.commandId })
        .returning();
      if (!created) {
        const [raced] = await transaction
          .select()
          .from(catalogProductMedia)
          .where(eq(catalogProductMedia.commandId, input.commandId))
          .limit(1);
        if (!raced) throw new Error("Catalog media insert returned no row.");
        assertSameUpload(raced, {
          productId,
          variantId,
          variantColor: requestedVariantColor,
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          ...(input.reason ? { reason: input.reason } : {}),
        });
        if (raced.status === "ready" || raced.status === "rejected") {
          return raced;
        }
        if (raced.status === "deleting" || raced.status === "deleted") {
          throw new ConflictException(
            "This upload command has already been removed.",
          );
        }
        return raced;
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_upload_started",
        subjectType: "catalog_product_media",
        subjectId: created.id,
        reason: input.reason,
        metadata: {
          productId,
          variantId,
          variantColor,
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
        },
      });
      return created;
    });

    if (record.status === "ready" || record.status === "rejected") {
      return toCatalogMedia(record);
    }

    try {
      await this.storage.putQuarantinedObject({
        key: record.objectKey,
        body: image.buffer,
        contentType: image.contentType,
        sha256: sourceSha256,
      });
    } catch (error: unknown) {
      this.logStorageFailure("put", record.id, error);
      throw mediaStorageUnavailable();
    }

    const completed = await this.database.db.transaction(
      async (transaction) => {
        await this.authorization.authorize(
          CatalogPolicy,
          "manage",
          actor,
          transaction,
        );
        const [current] = await transaction
          .select()
          .from(catalogProductMedia)
          .where(eq(catalogProductMedia.id, record.id))
          .for("update")
          .limit(1);
        if (!current) throw new NotFoundException("Catalog media not found.");
        if (current.status === "ready" || current.status === "rejected") {
          return current;
        }
        if (
          current.status !== "uploading" &&
          current.status !== "quarantined" &&
          current.status !== "processing"
        ) {
          throw new ConflictException(
            "This upload is no longer available for completion.",
          );
        }
        if (current.status !== "uploading") return current;

        const [updated] = await transaction
          .update(catalogProductMedia)
          .set({ status: "quarantined", updatedAt: new Date() })
          .where(eq(catalogProductMedia.id, current.id))
          .returning();
        if (!updated) throw new Error("Catalog media update returned no row.");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.media_quarantined",
          subjectType: "catalog_product_media",
          subjectId: updated.id,
          reason: input.reason,
          metadata: {
            productId,
            variantId: updated.variantId,
            contentType: image.contentType,
            sizeBytes: image.buffer.byteLength,
          },
        });
        return updated;
      },
    );
    if (completed.status === "ready" || completed.status === "rejected") {
      return toCatalogMedia(completed);
    }
    return toCatalogMedia(
      await this.processAndPublish(actor, completed, image.buffer),
    );
  }

  async getPublishedDerivative(
    mediaId: string,
    rendition: CatalogMediaRendition,
    sha256: string,
  ): Promise<{ body: Buffer; sizeBytes: number }> {
    const [row] = await this.database.db
      .select({
        media: catalogProductMedia,
        isPublished: catalogProduct.isPublished,
      })
      .from(catalogProductMedia)
      .innerJoin(
        catalogProduct,
        eq(catalogProduct.id, catalogProductMedia.productId),
      )
      .leftJoin(
        catalogProductVariant,
        eq(catalogProductVariant.id, catalogProductMedia.variantId),
      )
      .where(
        and(
          eq(catalogProductMedia.id, mediaId),
          eq(catalogProductMedia.status, "ready"),
          eq(catalogProduct.isPublished, true),
          or(
            isNull(catalogProductMedia.variantId),
            eq(catalogProductVariant.isActive, true),
            isNotNull(catalogProductMedia.variantColor),
          ),
        ),
      )
      .limit(1);
    if (!row || !row.isPublished) {
      throw new NotFoundException("Catalog media not found.");
    }

    const parsed = CatalogMediaDerivativesSchema.safeParse(
      row.media.derivatives,
    );
    if (!parsed.success) {
      this.logger.error("Catalog media derivative manifest is invalid", {
        event: "catalog.media_manifest_invalid",
        mediaId,
      });
      throw mediaStorageUnavailable();
    }
    const derivative = parsed.data.find(
      (item) => item.rendition === rendition && item.sha256 === sha256,
    );
    if (!derivative) throw new NotFoundException("Catalog media not found.");

    try {
      const body = await this.storage.getPublishedDerivative({
        key: derivativeObjectKey(mediaId, derivative.sha256),
        sha256: derivative.sha256,
        sizeBytes: derivative.sizeBytes,
      });
      return { body, sizeBytes: derivative.sizeBytes };
    } catch (error: unknown) {
      this.logStorageFailure("get", mediaId, error);
      throw mediaStorageUnavailable();
    }
  }

  async getManagementPreview(
    actor: AccessPrincipal,
    productId: string,
    mediaId: string,
  ): Promise<Buffer> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const [media] = await this.database.db
      .select({ derivatives: catalogProductMedia.derivatives })
      .from(catalogProductMedia)
      .where(
        and(
          eq(catalogProductMedia.id, mediaId),
          eq(catalogProductMedia.productId, productId),
          eq(catalogProductMedia.status, "ready"),
        ),
      )
      .limit(1);
    if (!media) throw new NotFoundException("Catalog media not found.");

    const parsed = CatalogMediaDerivativesSchema.safeParse(media.derivatives);
    if (!parsed.success) {
      this.logger.error("Catalog media derivative manifest is invalid", {
        event: "catalog.media_manifest_invalid",
        mediaId,
      });
      throw mediaStorageUnavailable();
    }
    const preview = parsed.data.find(({ rendition }) => rendition === "card");
    if (!preview) throw new NotFoundException("Catalog media not found.");

    try {
      return await this.storage.getPublishedDerivative({
        key: derivativeObjectKey(mediaId, preview.sha256),
        sha256: preview.sha256,
        sizeBytes: preview.sizeBytes,
      });
    } catch (error: unknown) {
      this.logStorageFailure("get", mediaId, error);
      throw mediaStorageUnavailable();
    }
  }

  private async processAndPublish(
    actor: AccessPrincipal,
    record: UploadRecord,
    source: Buffer,
  ): Promise<UploadRecord> {
    const claimed = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [product] = await transaction
        .select({ id: catalogProduct.id })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, record.productId))
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundException("Product not found.");
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.id, record.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status === "ready" || current.status === "rejected") {
        return current;
      }
      if (current.status !== "quarantined" && current.status !== "processing") {
        throw new ConflictException(
          "This catalog media item cannot be processed in its current state.",
        );
      }
      const [processingRecord] = await transaction
        .update(catalogProductMedia)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!processingRecord)
        throw new Error("Catalog media claim returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_processing_started",
        subjectType: "catalog_product_media",
        subjectId: current.id,
        reason: current.reason ?? undefined,
        metadata: { productId: current.productId },
      });
      return processingRecord;
    });
    if (claimed.status === "ready" || claimed.status === "rejected") {
      return claimed;
    }

    let processed: Awaited<ReturnType<typeof processCatalogImage>>;
    try {
      processed = await processCatalogImage(
        source,
        record.contentType as CatalogMedia["contentType"],
      );
    } catch (error: unknown) {
      if (!(error instanceof InvalidCatalogImageError)) throw error;
      return this.markRejected(actor, record);
    }

    const derivatives = CatalogMediaDerivativesSchema.parse(
      processed.derivatives.map(({ metadata }) => metadata),
    );
    const manifest = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.id, record.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status === "ready") return current;
      if (current.status !== "processing") {
        throw new ConflictException(
          "This catalog media item changed while it was being processed.",
        );
      }
      const [updated] = await transaction
        .update(catalogProductMedia)
        .set({ derivatives, updatedAt: new Date() })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!updated)
        throw new Error("Catalog media manifest update returned no row.");
      return updated;
    });
    if (manifest.status === "ready") return manifest;

    try {
      const writtenKeys = new Set<string>();
      for (const item of processed.derivatives) {
        const key = derivativeObjectKey(record.id, item.metadata.sha256);
        if (writtenKeys.has(key)) continue;
        writtenKeys.add(key);
        await this.storage.putDerivativeObject({
          key,
          body: item.body,
          sha256: item.metadata.sha256,
        });
      }
    } catch (error: unknown) {
      this.logStorageFailure("put-derivative", record.id, error);
      throw mediaStorageUnavailable();
    }

    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.id, record.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status === "ready") return current;
      if (current.status !== "processing") {
        throw new ConflictException(
          "This catalog media item changed while it was being processed.",
        );
      }
      const [ready] = await transaction
        .update(catalogProductMedia)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!ready) throw new Error("Catalog media publication returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_ready",
        subjectType: "catalog_product_media",
        subjectId: ready.id,
        reason: ready.reason ?? undefined,
        metadata: {
          productId: ready.productId,
          renditionCount: derivatives.length,
          sourceSha256: ready.sourceSha256,
        },
      });
      return ready;
    });
  }

  private async markRejected(
    actor: AccessPrincipal,
    record: UploadRecord,
  ): Promise<UploadRecord> {
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.id, record.id))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status === "rejected") return current;
      if (current.status !== "processing") {
        throw new ConflictException(
          "This catalog media item changed while it was being processed.",
        );
      }
      const [rejected] = await transaction
        .update(catalogProductMedia)
        .set({ derivatives: [], status: "rejected", updatedAt: new Date() })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!rejected)
        throw new Error("Catalog media rejection returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_rejected",
        subjectType: "catalog_product_media",
        subjectId: rejected.id,
        reason: rejected.reason ?? undefined,
        metadata: {
          productId: rejected.productId,
          rejectionCode: "IMAGE_DECODE_FAILED",
        },
      });
      return rejected;
    });
  }

  async updateMetadata(
    actor: AccessPrincipal,
    productId: string,
    mediaId: string,
    input: CatalogMediaUpdateInput,
  ): Promise<CatalogMedia> {
    const updated = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [product] = await transaction
        .select({
          id: catalogProduct.id,
          isPublished: catalogProduct.isPublished,
        })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundException("Product not found.");

      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(
          and(
            eq(catalogProductMedia.id, mediaId),
            eq(catalogProductMedia.productId, productId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status !== "ready") {
        throw new ConflictException(
          "Only processed images can have their alt text and color changed.",
        );
      }

      let variantId = input.variantId;
      let variantColor = input.variantColor;
      if (variantId) {
        const [variant] = await transaction
          .select({
            id: catalogProductVariant.id,
            color: catalogProductVariant.color,
          })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.id, variantId),
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
            ),
          )
          .limit(1);
        if (!variant) {
          throw new BadRequestException(
            "Select an active SKU that belongs to this product.",
          );
        }
        variantColor = variant.color;
      } else if (variantColor) {
        const [variant] = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
              sql`lower(btrim(${catalogProductVariant.color})) = lower(btrim(${variantColor}))`,
            ),
          )
          .limit(1);
        if (!variant) {
          throw new BadRequestException(
            "Select a color used by an active product variant.",
          );
        }
        variantColor = variant.color;
      }

      const [saved] = await transaction
        .update(catalogProductMedia)
        .set({
          altText: input.altText,
          variantId,
          variantColor,
          updatedAt: new Date(),
        })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!saved) throw new Error("Catalog media update returned no row.");

      if (product.isPublished) {
        const activeVariants = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
            ),
          );
        await validateProductMediaCoverage(
          transaction,
          productId,
          activeVariants,
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_metadata_updated",
        subjectType: "catalog_product_media",
        subjectId: saved.id,
        reason: input.reason,
        metadata: {
          productId,
          variantId: saved.variantId,
          variantColor: saved.variantColor,
          altTextChanged: current.altText !== saved.altText,
          associationChanged:
            current.variantId !== saved.variantId ||
            current.variantColor !== saved.variantColor,
        },
      });
      return saved;
    });
    return toCatalogMedia(updated);
  }

  async delete(
    actor: AccessPrincipal,
    productId: string,
    mediaId: string,
    input: CatalogMediaDeleteInput,
  ): Promise<void> {
    const record = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [product] = await transaction
        .select({
          id: catalogProduct.id,
          isPublished: catalogProduct.isPublished,
        })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .for("update")
        .limit(1);
      if (!product) throw new NotFoundException("Product not found.");
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(
          and(
            eq(catalogProductMedia.id, mediaId),
            eq(catalogProductMedia.productId, productId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Catalog media not found.");
      if (current.status === "deleted") return current;
      if (current.status === "deleting") return current;
      if (current.status === "uploading" || current.status === "processing") {
        throw new ConflictException(
          "Finish or retry image processing before deleting this media item.",
        );
      }

      if (product.isPublished && current.status === "ready") {
        const activeVariants = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
            ),
          );
        await validateProductMediaCoverage(
          transaction,
          productId,
          activeVariants,
          current.id,
        );
      }

      const [deleting] = await transaction
        .update(catalogProductMedia)
        .set({
          status: "deleting",
          deletionReason: input.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!deleting) throw new Error("Catalog media update returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_deletion_started",
        subjectType: "catalog_product_media",
        subjectId: deleting.id,
        reason: input.reason,
        metadata: { productId, variantId: deleting.variantId },
      });
      return deleting;
    });

    if (record.status === "deleted") return;
    try {
      const derivatives = CatalogMediaDerivativesSchema.safeParse(
        record.derivatives,
      );
      if (!derivatives.success) {
        throw new Error("Catalog media derivative manifest is invalid.");
      }
      await this.storage.deleteMediaObjects([
        ...new Set([
          record.objectKey,
          ...derivatives.data.map(({ sha256 }) =>
            derivativeObjectKey(record.id, sha256),
          ),
        ]),
      ]);
    } catch (error: unknown) {
      this.logStorageFailure("delete", record.id, error);
      throw mediaStorageUnavailable();
    }

    await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogProductMedia)
        .where(eq(catalogProductMedia.id, record.id))
        .for("update")
        .limit(1);
      if (!current || current.status === "deleted") return;
      if (current.status !== "deleting") {
        throw new ConflictException(
          "This catalog media item changed while it was being deleted.",
        );
      }
      const [deleted] = await transaction
        .update(catalogProductMedia)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(catalogProductMedia.id, current.id))
        .returning();
      if (!deleted) throw new Error("Catalog media update returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.media_deleted",
        subjectType: "catalog_product_media",
        subjectId: deleted.id,
        reason: deleted.deletionReason ?? input.reason,
        metadata: { productId, variantId: deleted.variantId },
      });
    });
  }

  private logStorageFailure(
    operation: "put" | "put-derivative" | "get" | "delete",
    mediaId: string,
    error: unknown,
  ): void {
    const requestId = getCurrentRequestId();
    this.logger.error("Catalog media storage request failed", {
      event: "catalog.media_storage_failed",
      operation,
      mediaId,
      errorName: error instanceof Error ? error.name : "unknown",
      ...(requestId ? { requestId } : {}),
    });
  }
}

function assertSameUpload(
  existing: UploadRecord,
  next: {
    productId: string;
    variantId: string | null;
    variantColor: string | null;
    contentType: CatalogMedia["contentType"];
    sizeBytes: number;
    sourceSha256: string;
    altText: string;
    reason?: string;
  },
): void {
  if (
    existing.productId !== next.productId ||
    existing.contentType !== next.contentType ||
    existing.sizeBytes !== next.sizeBytes ||
    existing.sourceSha256 !== next.sourceSha256
  ) {
    throw new ConflictException(
      "This upload command was already used for different content.",
    );
  }
}

function quarantineObjectKey(mediaId: string): string {
  return `quarantine/${mediaId}/source`;
}

export function derivativeObjectKey(mediaId: string, sha256: string): string {
  return `published/${mediaId}/${sha256}.webp`;
}

function toCatalogMedia(record: UploadRecord): CatalogMedia {
  return CatalogMediaSchema.parse({
    id: record.id,
    commandId: record.commandId,
    productId: record.productId,
    variantId: record.variantId,
    variantColor: record.variantColor,
    altText: record.altText,
    reason: record.reason,
    deletionReason: record.deletionReason,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    sortOrder: record.sortOrder,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function mediaStorageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: "Catalog media storage is temporarily unavailable.",
    errorCode: "CATALOG_MEDIA_STORAGE_UNAVAILABLE",
  });
}

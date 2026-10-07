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
import { fileTypeFromBuffer } from "file-type";
import { and, asc, eq, isNull, not, or, sql } from "drizzle-orm";
import {
  CatalogMediaDerivativesSchema,
  CatalogMediaContentTypeSchema,
  CatalogMediaSchema,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
  MAX_CATALOG_PRODUCT_MEDIA,
  type CatalogMediaDerivatives,
  type CatalogMediaRendition,
  type CatalogMedia,
  type CatalogMediaDeleteInput,
  type CatalogMediaUploadInput,
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
import { R2Storage } from "./r2-storage.js";
import { getCurrentRequestId } from "../../platform/request-context.js";
import {
  InvalidCatalogImageError,
  processCatalogImage,
} from "./catalog-image-processor.js";

export interface CatalogMediaUploadFile {
  buffer: Buffer;
  size: number;
}

interface UploadRecord {
  id: string;
  commandId: string;
  productId: string;
  variantId: string | null;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sourceSha256: string;
  derivatives: CatalogMediaDerivatives;
  altText: string;
  reason: string;
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

  async upload(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogMediaUploadInput,
    file: CatalogMediaUploadFile | undefined,
  ): Promise<CatalogMedia> {
    const image = await validateUploadedImage(file);
    const sourceSha256 = createHash("sha256")
      .update(image.buffer)
      .digest("hex");
    const variantId = input.variantId || null;

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
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          reason: input.reason,
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

      if (variantId) {
        const [variant] = await transaction
          .select({ id: catalogProductVariant.id })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.id, variantId),
              eq(catalogProductVariant.productId, productId),
            ),
          )
          .limit(1);
        if (!variant)
          throw new BadRequestException(
            "Select a variant that belongs to this product.",
          );
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
          objectKey: quarantineObjectKey(id),
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          reason: input.reason,
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
          contentType: image.contentType,
          sizeBytes: image.buffer.byteLength,
          sourceSha256,
          altText: input.altText,
          reason: input.reason,
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
        reason: current.reason,
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
        reason: ready.reason,
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
        reason: rejected.reason,
        metadata: {
          productId: rejected.productId,
          rejectionCode: "IMAGE_DECODE_FAILED",
        },
      });
      return rejected;
    });
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

      const [deleting] = await transaction
        .update(catalogProductMedia)
        .set({
          status: "deleting",
          deletionReason: input.reason,
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

async function validateUploadedImage(
  file: CatalogMediaUploadFile | undefined,
): Promise<{
  buffer: Buffer;
  contentType: CatalogMedia["contentType"];
}> {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException("Choose one image file to upload.");
  }
  if (
    !Number.isSafeInteger(file.size) ||
    file.size !== file.buffer.byteLength ||
    file.size < 1 ||
    file.size > MAX_CATALOG_MEDIA_UPLOAD_BYTES
  ) {
    throw new BadRequestException(
      `Image files must be no larger than ${MAX_CATALOG_MEDIA_UPLOAD_BYTES} bytes.`,
    );
  }

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch {
    throw new BadRequestException("The uploaded image could not be inspected.");
  }
  const parsedContentType = CatalogMediaContentTypeSchema.safeParse(
    detected?.mime,
  );
  if (!parsedContentType.success) {
    throw new BadRequestException("Use a JPEG, PNG, or WebP image file.");
  }
  return { buffer: file.buffer, contentType: parsedContentType.data };
}

function assertSameUpload(
  existing: UploadRecord,
  next: {
    productId: string;
    variantId: string | null;
    contentType: CatalogMedia["contentType"];
    sizeBytes: number;
    sourceSha256: string;
    altText: string;
    reason: string;
  },
): void {
  if (
    existing.productId !== next.productId ||
    existing.variantId !== next.variantId ||
    existing.contentType !== next.contentType ||
    existing.sizeBytes !== next.sizeBytes ||
    existing.sourceSha256 !== next.sourceSha256 ||
    existing.altText !== next.altText ||
    existing.reason !== next.reason
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

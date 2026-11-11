import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, not, sql } from "drizzle-orm";
import {
  MAX_CATALOG_PRODUCT_VIDEOS,
  MAX_CATALOG_VIDEO_CAPTION_BYTES,
  CatalogVideoCaptionSchema,
  type CatalogManagedVideo,
  type CatalogProductVideo,
  type CatalogProductVideoList,
  type CatalogVideoCaption,
  type CatalogVideoDeleteInput,
  type CatalogVideoMetadataUpdateInput,
  type CatalogVideoOrderInput,
  type CatalogVideoProvisionInput,
  type CatalogVideoProvisionResult,
} from "@aaraj/contracts";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuditTransaction } from "../../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../../platform/authorization/permissions.service.js";
import { DatabaseService } from "../../platform/database/database.service.js";
import { getCurrentRequestId } from "../../platform/request-context.js";
import { CatalogPolicy } from "../catalog.policy.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogProductVideo,
  catalogVideoWebhookInbox,
} from "../catalog-schema.js";
import {
  CloudflareStreamService,
  isValidStreamUid,
  validateWebVtt,
} from "./cloudflare-stream.service.js";

type VideoRecord = typeof catalogProductVideo.$inferSelect;
type VideoWebhookPayload = {
  uid: string;
  readyToStream?: boolean;
  status?: { state?: string; pctComplete?: string };
  duration?: number;
};

@Injectable()
export class CatalogVideoService {
  private readonly logger = new Logger(CatalogVideoService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly stream: CloudflareStreamService,
  ) {}

  async listForManagement(
    actor: AccessPrincipal,
    productId: string,
  ): Promise<CatalogProductVideoList> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const rows = await this.database.db.transaction(async (transaction) => {
      await this.requireProduct(productId, transaction);
      const expired = await transaction
        .select()
        .from(catalogProductVideo)
        .where(
          and(
            eq(catalogProductVideo.productId, productId),
            eq(catalogProductVideo.status, "awaiting_upload"),
            sql`${catalogProductVideo.uploadExpiresAt} <= now()`,
          ),
        )
        .for("update");
      if (expired.length > 0) {
        const expiredIds = expired.map((video) => video.id);
        await transaction
          .update(catalogProductVideo)
          .set({
            status: "error",
            uploadUrlCiphertext: null,
            uploadExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(inArray(catalogProductVideo.id, expiredIds));
        for (const video of expired) {
          await this.audit.append(transaction, {
            actorType: "service",
            eventType: "catalog.video_upload_expired",
            subjectType: "catalog_product_video",
            subjectId: video.id,
            metadata: { provider: "cloudflare_stream" },
          });
        }
      }
      return transaction
        .select()
        .from(catalogProductVideo)
        .where(
          and(
            eq(catalogProductVideo.productId, productId),
            not(eq(catalogProductVideo.status, "deleted")),
          ),
        )
        .orderBy(asc(catalogProductVideo.sortOrder));
    });
    return { videos: rows.map(toManagedVideo) };
  }

  async provisionUpload(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogVideoProvisionInput,
  ): Promise<CatalogVideoProvisionResult> {
    const reserved = await this.database.db.transaction(async (transaction) => {
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

      const [existing] = await transaction
        .select()
        .from(catalogProductVideo)
        .where(eq(catalogProductVideo.commandId, input.commandId))
        .for("update")
        .limit(1);
      if (existing) {
        if (!sameProvisionCommand(existing, productId, input)) {
          throw new ConflictException(
            "This video upload command was already used with different details.",
          );
        }
        if (
          existing.status === "awaiting_upload" &&
          existing.uploadUrlCiphertext &&
          existing.uploadExpiresAt &&
          existing.uploadExpiresAt.getTime() > Date.now()
        ) {
          return {
            video: existing,
            uploadUrl: this.stream.decryptUploadUrl(
              existing.uploadUrlCiphertext,
              existing.id,
            ),
            isReplay: true,
          };
        }
        if (existing.status === "provisioning") {
          throw new ConflictException(
            "This video upload is still being prepared. Refresh the media list and retry shortly.",
          );
        }
        throw new ConflictException(
          "This video upload command can no longer be resumed. Start a new upload command.",
        );
      }

      const activeMedia = await transaction
        .select({ id: catalogProductVideo.id })
        .from(catalogProductVideo)
        .where(
          and(
            eq(catalogProductVideo.productId, productId),
            not(eq(catalogProductVideo.status, "deleted")),
          ),
        )
        .orderBy(asc(catalogProductVideo.sortOrder))
        .for("update")
        .limit(MAX_CATALOG_PRODUCT_VIDEOS);
      if (activeMedia.length >= MAX_CATALOG_PRODUCT_VIDEOS) {
        throw new BadRequestException(
          `A product can have at most ${MAX_CATALOG_PRODUCT_VIDEOS} videos.`,
        );
      }

      const color = input.variantColor?.trim() ?? null;
      let canonicalColor: string | null = null;
      if (color) {
        const [variant] = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
              sql`lower(btrim(${catalogProductVariant.color})) = lower(${color})`,
            ),
          )
          .limit(1);
        if (!variant) {
          throw new BadRequestException(
            "Choose a color that has an active product variant.",
          );
        }
        canonicalColor = variant.color;
      }
      const maximumOrder = await transaction
        .select({
          value: sql<number>`coalesce(max(${catalogProductVideo.sortOrder}), -1)`,
        })
        .from(catalogProductVideo)
        .where(eq(catalogProductVideo.productId, productId));
      const id = randomUUID();
      const [video] = await transaction
        .insert(catalogProductVideo)
        .values({
          id,
          commandId: input.commandId,
          productId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          variantColor: canonicalColor,
          fileSizeBytes: input.fileSizeBytes,
          sortOrder: (maximumOrder[0]?.value ?? -1) + 1,
          status: "provisioning",
          reason: input.reason?.trim() ?? null,
          createdBy: actor.id,
        })
        .returning();
      if (!video) throw new Error("Video upload reservation was not created.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.video_upload_started",
        subjectType: "catalog_product_video",
        subjectId: video.id,
        requestId: getCurrentRequestId(),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        metadata: {
          commandId: input.commandId,
          fileSizeBytes: input.fileSizeBytes,
        },
      });
      return { video, isReplay: false as const };
    });

    if (reserved.isReplay) {
      return {
        video: toManagedVideo(reserved.video),
        uploadUrl: reserved.uploadUrl,
      };
    }

    let upload: Awaited<ReturnType<CloudflareStreamService["createTusUpload"]>>;
    try {
      upload = await this.stream.createTusUpload({
        fileSizeBytes: input.fileSizeBytes,
        title: input.title.trim(),
        actorId: actor.id,
        productId,
        videoId: reserved.video.id,
      });
    } catch (error) {
      await this.markProvisionFailed(reserved.video.id, errorCode(error));
      throw error;
    }

    const ciphertext = this.stream.encryptUploadUrl(
      upload.uploadUrl,
      reserved.video.id,
    );
    let updatedRows: VideoRecord[];
    try {
      updatedRows = await this.database.db.transaction(async (transaction) => {
        const updated = await transaction
          .update(catalogProductVideo)
          .set({
            providerUid: upload.providerUid,
            uploadUrlCiphertext: ciphertext,
            uploadExpiresAt: upload.expiresAt,
            status: "awaiting_upload",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogProductVideo.id, reserved.video.id),
              eq(catalogProductVideo.status, "provisioning"),
            ),
          )
          .returning();
        if (updated[0]) {
          await this.audit.append(transaction, {
            actorType: "service",
            eventType: "catalog.video_upload_url_issued",
            subjectType: "catalog_product_video",
            subjectId: reserved.video.id,
            requestId: getCurrentRequestId(),
            metadata: {
              provider: "cloudflare_stream",
              expiresAt: upload.expiresAt.toISOString(),
            },
          });
        }
        return updated;
      });
    } catch (error) {
      await this.stream.deleteVideo(upload.providerUid).catch(() => undefined);
      await this.markProvisionFailed(reserved.video.id, errorCode(error));
      throw error;
    }
    const video = updatedRows[0];
    if (!video) {
      await this.stream.deleteVideo(upload.providerUid).catch(() => undefined);
      await this.markProvisionFailed(reserved.video.id, "upload_state_changed");
      throw new ConflictException(
        "The video changed while its upload URL was being prepared. Refresh the media list.",
      );
    }
    return { video: toManagedVideo(video), uploadUrl: upload.uploadUrl };
  }

  async completeUpload(
    actor: AccessPrincipal,
    productId: string,
    videoId: string,
  ): Promise<CatalogManagedVideo> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const current = await this.getVideoRecord(productId, videoId);
    if (current.status === "processing" || current.status === "ready")
      return toManagedVideo(current);
    if (current.status !== "awaiting_upload" || !current.providerUid) {
      throw new ConflictException("This video is not waiting for an upload.");
    }

    // The browser's completion callback is only a hint. Stream is the source of
    // truth for whether the TUS upload actually reached the provider.
    const details = await this.stream.getVideo(current.providerUid);
    const providerState = details.status?.state?.toLowerCase();
    if (providerState === "pendingupload") {
      throw new ConflictException(
        "Cloudflare Stream has not received the complete video yet.",
      );
    }
    const status = providerVideoStatus(details.readyToStream, providerState);
    const video = await this.applyProviderState(
      current.providerUid,
      status,
      details.duration,
      {
        actorId: actor.id,
        eventType: "catalog.video_upload_completed",
      },
    );
    return video;
  }

  async updateMetadata(
    actor: AccessPrincipal,
    productId: string,
    videoId: string,
    input: CatalogVideoMetadataUpdateInput,
  ): Promise<CatalogManagedVideo> {
    const updated = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      await this.lockProduct(transaction, productId);
      const existing = await this.findVideo(
        transaction,
        productId,
        videoId,
        true,
      );
      if (["deleting", "deleted"].includes(existing.status)) {
        throw new ConflictException("Deleted videos cannot be edited.");
      }
      let color = input.variantColor;
      if (color !== undefined && color !== null) {
        const [variant] = await transaction
          .select({ color: catalogProductVariant.color })
          .from(catalogProductVariant)
          .where(
            and(
              eq(catalogProductVariant.productId, productId),
              eq(catalogProductVariant.isActive, true),
              sql`lower(btrim(${catalogProductVariant.color})) = lower(${color.trim()})`,
            ),
          )
          .limit(1);
        if (!variant)
          throw new BadRequestException("Choose an active product color.");
        color = variant.color;
      }
      const [video] = await transaction
        .update(catalogProductVideo)
        .set({
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.variantColor !== undefined
            ? { variantColor: color ?? null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVideo.id, videoId))
        .returning();
      if (!video) throw new NotFoundException("Video not found.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.video_metadata_updated",
        subjectType: "catalog_product_video",
        subjectId: videoId,
        metadata: {
          titleChanged: input.title !== undefined,
          descriptionChanged: input.description !== undefined,
          variantColorChanged: input.variantColor !== undefined,
        },
      });
      return video;
    });
    return toManagedVideo(updated);
  }

  async reorder(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogVideoOrderInput,
  ): Promise<CatalogProductVideoList> {
    const videos = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      await this.lockProduct(transaction, productId);
      const existingRows = await transaction
        .select()
        .from(catalogProductVideo)
        .where(
          and(
            eq(catalogProductVideo.productId, productId),
            not(eq(catalogProductVideo.status, "deleted")),
          ),
        )
        .orderBy(
          asc(catalogProductVideo.sortOrder),
          asc(catalogProductVideo.id),
        )
        .for("update");
      if (
        existingRows.length !== input.videoIds.length ||
        input.videoIds.some((id) => !existingRows.some((row) => row.id === id))
      ) {
        throw new ConflictException(
          "Product videos changed. Refresh and try again.",
        );
      }
      const availableOrders = existingRows.map(({ sortOrder }) => sortOrder);
      const offset = Math.max(-1, ...availableOrders) + existingRows.length + 1;
      await transaction
        .update(catalogProductVideo)
        .set({
          sortOrder: sql`${catalogProductVideo.sortOrder} + ${offset}`,
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVideo.productId, productId));
      const cases = sql.join(
        input.videoIds.map(
          (id, index) =>
            sql`when ${catalogProductVideo.id} = ${id} then ${availableOrders[index]}`,
        ),
        sql` `,
      );
      await transaction
        .update(catalogProductVideo)
        .set({
          sortOrder: sql`case ${cases} else ${catalogProductVideo.sortOrder} end`,
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVideo.productId, productId));
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.video_reordered",
        subjectType: "catalog_product",
        subjectId: productId,
        metadata: { videoIds: input.videoIds },
      });
      return transaction
        .select()
        .from(catalogProductVideo)
        .where(
          and(
            eq(catalogProductVideo.productId, productId),
            not(eq(catalogProductVideo.status, "deleted")),
          ),
        )
        .orderBy(
          asc(catalogProductVideo.sortOrder),
          asc(catalogProductVideo.id),
        );
    });
    return { videos: videos.map(toManagedVideo) };
  }

  async syncStatus(
    actor: AccessPrincipal,
    productId: string,
    videoId: string,
  ): Promise<CatalogManagedVideo> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const video = await this.getVideoRecord(productId, videoId);
    if (
      !video.providerUid ||
      ["deleted", "deleting", "error"].includes(video.status)
    ) {
      return toManagedVideo(video);
    }
    const details = await this.stream.getVideo(video.providerUid);
    const state = details.status?.state?.toLowerCase();
    const status = providerVideoStatus(details.readyToStream, state);
    return this.applyProviderState(video.providerUid, status, details.duration);
  }

  async uploadCaption(
    actor: AccessPrincipal,
    productId: string,
    videoId: string,
    language: string,
    file: { buffer?: Buffer; size?: number } | undefined,
  ): Promise<CatalogManagedVideo> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const video = await this.getVideoRecord(productId, videoId);
    if (video.status !== "ready" || !video.providerUid) {
      throw new ConflictException(
        "Captions can be added after the video is ready.",
      );
    }
    if (!file?.buffer || !file.size)
      throw new BadRequestException("Choose a WebVTT caption file.");
    if (file.size > MAX_CATALOG_VIDEO_CAPTION_BYTES) {
      throw new BadRequestException(
        "WebVTT captions must be no larger than 2 MB.",
      );
    }
    validateWebVtt(
      file.buffer,
      video.durationSeconds ? Number(video.durationSeconds) : undefined,
    );
    const captions = await this.stream.uploadCaption(
      video.providerUid,
      language,
      file.buffer,
    );
    const [updated] = await this.database.db.transaction(
      async (transaction) => {
        await this.authorization.authorize(
          CatalogPolicy,
          "manage",
          actor,
          transaction,
        );
        await this.lockProduct(transaction, productId);
        const rows = await transaction
          .update(catalogProductVideo)
          .set({ captions, updatedAt: new Date() })
          .where(
            and(
              eq(catalogProductVideo.id, videoId),
              eq(catalogProductVideo.status, "ready"),
            ),
          )
          .returning();
        if (!rows[0])
          throw new ConflictException(
            "The video changed while its captions were uploaded.",
          );
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.video_caption_uploaded",
          subjectType: "catalog_product_video",
          subjectId: videoId,
          metadata: { language, bytes: file.size },
        });
        return rows;
      },
    );
    if (!updated) throw new NotFoundException("Video not found.");
    return toManagedVideo(updated);
  }

  async delete(
    actor: AccessPrincipal,
    productId: string,
    videoId: string,
    input: CatalogVideoDeleteInput,
  ): Promise<void> {
    const video = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      await this.lockProduct(transaction, productId);
      const current = await this.findVideo(
        transaction,
        productId,
        videoId,
        true,
      );
      if (current.status === "deleted") return current;
      const [updated] = await transaction
        .update(catalogProductVideo)
        .set({
          status: "deleting",
          deletionReason: input.reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVideo.id, videoId))
        .returning();
      if (!updated) throw new NotFoundException("Video not found.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.video_deletion_requested",
        subjectType: "catalog_product_video",
        subjectId: videoId,
        reason: input.reason.trim(),
        metadata: { providerUidPresent: Boolean(current.providerUid) },
      });
      return updated;
    });
    if (video.status === "deleted") return;
    try {
      if (video.providerUid) await this.stream.deleteVideo(video.providerUid);
      await this.database.db.transaction(async (transaction) => {
        await transaction
          .update(catalogProductVideo)
          .set({
            status: "deleted",
            uploadUrlCiphertext: null,
            uploadExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogProductVideo.id, videoId),
              eq(catalogProductVideo.status, "deleting"),
            ),
          );
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.video_deleted",
          subjectType: "catalog_product_video",
          subjectId: videoId,
          reason: input.reason.trim(),
          metadata: {},
        });
      });
    } catch (error) {
      this.logger.warn(
        `Catalog video deletion remains pending: ${errorCode(error)}`,
      );
      throw new ServiceUnavailableException({
        message:
          "The video is hidden from the catalogue, but provider deletion is pending. Retry deletion to finish cleanup.",
        errorCode: "CATALOG_VIDEO_DELETE_PENDING",
      });
    }
  }

  async listPublishedForSlug(
    slug: string,
  ): Promise<{ videos: CatalogProductVideo[] }> {
    const [product] = await this.database.db
      .select({ id: catalogProduct.id })
      .from(catalogProduct)
      .where(
        and(
          eq(catalogProduct.slug, slug),
          eq(catalogProduct.isPublished, true),
        ),
      )
      .limit(1);
    if (!product) throw new NotFoundException("Product not found.");
    const rows = await this.database.db
      .select()
      .from(catalogProductVideo)
      .where(
        and(
          eq(catalogProductVideo.productId, product.id),
          eq(catalogProductVideo.status, "ready"),
        ),
      )
      .orderBy(asc(catalogProductVideo.sortOrder), asc(catalogProductVideo.id));
    const videos = await Promise.all(
      rows.flatMap((row) => {
        if (!row.providerUid) return [];
        return [
          this.stream.getPlaybackUrl(row.providerUid).then((playbackUrl) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            variantColor: row.variantColor,
            sortOrder: row.sortOrder,
            playbackUrl,
            durationSeconds: numberOrNull(row.durationSeconds),
            captions: parseCaptions(row.captions),
          })),
        ];
      }),
    );
    return { videos };
  }

  async handleWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<void> {
    if (!this.stream.verifyWebhook(rawBody, signatureHeader)) {
      throw new UnauthorizedException(
        "Cloudflare Stream webhook signature is invalid.",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException(
        "Cloudflare Stream webhook payload is invalid.",
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestException(
        "Cloudflare Stream webhook payload is invalid.",
      );
    }
    const value = payload as Record<string, unknown>;
    const providerUid = value.uid;
    if (typeof providerUid !== "string" || !isValidStreamUid(providerUid)) {
      throw new BadRequestException(
        "Cloudflare Stream webhook video ID is invalid.",
      );
    }
    const rawStatus = value.status;
    const status =
      rawStatus && typeof rawStatus === "object" && !Array.isArray(rawStatus)
        ? (rawStatus as Record<string, unknown>)
        : {};
    const state =
      typeof status.state === "string" ? status.state.toLowerCase() : "";
    const readyToStream = value.readyToStream === true;
    const duration =
      typeof value.duration === "number" && Number.isFinite(value.duration)
        ? value.duration
        : null;
    const projected: VideoWebhookPayload = {
      uid: providerUid,
      readyToStream,
      status: {
        ...(state ? { state } : {}),
        ...(typeof status.pctComplete === "string"
          ? { pctComplete: status.pctComplete }
          : {}),
      },
      ...(duration === null ? {} : { duration }),
    };
    const fingerprint = createHash("sha256").update(rawBody).digest("hex");
    await this.database.db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(catalogVideoWebhookInbox)
        .values({ fingerprint, providerUid, payload: projected })
        .onConflictDoNothing({ target: catalogVideoWebhookInbox.fingerprint })
        .returning({ id: catalogVideoWebhookInbox.id });
      if (!inserted[0]) return;
      const [video] = await transaction
        .select()
        .from(catalogProductVideo)
        .where(eq(catalogProductVideo.providerUid, providerUid))
        .for("update")
        .limit(1);
      if (!video || ["deleted", "deleting"].includes(video.status)) return;
      const nextStatus = providerVideoStatus(readyToStream, state);
      if (video.status === "ready" && nextStatus !== "ready") return;
      if (video.status === "error" && nextStatus !== "ready") return;
      const safeDuration = safeDurationSeconds(duration);
      await transaction
        .update(catalogProductVideo)
        .set({
          status: nextStatus,
          ...(safeDuration ? { durationSeconds: safeDuration } : {}),
          ...(nextStatus === "ready" || nextStatus === "error"
            ? { uploadUrlCiphertext: null, uploadExpiresAt: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVideo.id, video.id));
      await this.audit.append(transaction, {
        actorType: "service",
        eventType:
          nextStatus === "ready"
            ? "catalog.video_ready"
            : nextStatus === "error"
              ? "catalog.video_processing_failed"
              : "catalog.video_processing_updated",
        subjectType: "catalog_product_video",
        subjectId: video.id,
        metadata: {
          provider: "cloudflare_stream",
          state: nextStatus,
          durationSeconds: safeDuration,
        },
      });
    });
  }

  private async applyProviderState(
    providerUid: string,
    status: "ready" | "processing" | "awaiting_upload" | "error",
    duration: number | undefined,
    auditContext?: { actorId: string; eventType: string },
  ): Promise<CatalogManagedVideo> {
    const safeDuration = safeDurationSeconds(duration);
    const [updated] = await this.database.db.transaction(
      async (transaction) => {
        const [video] = await transaction
          .select()
          .from(catalogProductVideo)
          .where(eq(catalogProductVideo.providerUid, providerUid))
          .for("update")
          .limit(1);
        if (!video) throw new NotFoundException("Video not found.");
        if (["deleted", "deleting"].includes(video.status)) return [video];
        if (
          (video.status === "ready" || video.status === "error") &&
          status !== "ready"
        ) {
          return [video];
        }
        if (
          video.status === status &&
          (safeDuration === null || safeDuration === video.durationSeconds)
        ) {
          return [video];
        }
        const rows = await transaction
          .update(catalogProductVideo)
          .set({
            status,
            ...(safeDuration ? { durationSeconds: safeDuration } : {}),
            ...(status === "ready" || status === "error"
              ? { uploadUrlCiphertext: null, uploadExpiresAt: null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(catalogProductVideo.id, video.id))
          .returning();
        await this.audit.append(transaction, {
          actorType: auditContext ? "user" : "service",
          ...(auditContext ? { actorId: auditContext.actorId } : {}),
          eventType: auditContext
            ? auditContext.eventType
            : status === "ready"
              ? "catalog.video_ready"
              : status === "error"
                ? "catalog.video_processing_failed"
                : "catalog.video_processing_updated",
          subjectType: "catalog_product_video",
          subjectId: video.id,
          metadata: {
            provider: "cloudflare_stream",
            state: status,
            durationSeconds: safeDuration,
          },
        });
        return rows;
      },
    );
    if (!updated) throw new NotFoundException("Video not found.");
    return toManagedVideo(updated);
  }

  private async requireProduct(
    productId: string,
    transaction?: AuditTransaction,
  ): Promise<void> {
    const query = (transaction ?? this.database.db)
      .select({ id: catalogProduct.id })
      .from(catalogProduct)
      .where(eq(catalogProduct.id, productId))
      .limit(1);
    const [product] = await query;
    if (!product) throw new NotFoundException("Product not found.");
  }

  private async markProvisionFailed(
    videoId: string,
    failureCode: string,
  ): Promise<void> {
    await this.database.db
      .transaction(async (transaction) => {
        const [updated] = await transaction
          .update(catalogProductVideo)
          .set({
            status: "error",
            uploadUrlCiphertext: null,
            uploadExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogProductVideo.id, videoId),
              eq(catalogProductVideo.status, "provisioning"),
            ),
          )
          .returning({ id: catalogProductVideo.id });
        if (!updated) return;
        await this.audit.append(transaction, {
          actorType: "service",
          eventType: "catalog.video_upload_provision_failed",
          subjectType: "catalog_product_video",
          subjectId: videoId,
          requestId: getCurrentRequestId(),
          metadata: { errorCode: failureCode },
        });
      })
      .catch((error) => {
        this.logger.error(
          `Could not mark video upload ${videoId} as failed: ${errorCode(error)}`,
        );
      });
  }

  private async lockProduct(
    transaction: AuditTransaction,
    productId: string,
  ): Promise<void> {
    const [product] = await transaction
      .select({ id: catalogProduct.id })
      .from(catalogProduct)
      .where(eq(catalogProduct.id, productId))
      .for("update")
      .limit(1);
    if (!product) throw new NotFoundException("Product not found.");
  }

  private async findVideo(
    transaction: AuditTransaction,
    productId: string,
    videoId: string,
    lock: boolean,
  ): Promise<VideoRecord> {
    const query = transaction
      .select()
      .from(catalogProductVideo)
      .where(
        and(
          eq(catalogProductVideo.id, videoId),
          eq(catalogProductVideo.productId, productId),
        ),
      )
      .limit(1);
    const [video] = lock ? await query.for("update") : await query;
    if (!video) throw new NotFoundException("Video not found.");
    return video as VideoRecord;
  }

  private async getVideoRecord(
    productId: string,
    videoId: string,
  ): Promise<VideoRecord> {
    const [video] = await this.database.db
      .select()
      .from(catalogProductVideo)
      .where(
        and(
          eq(catalogProductVideo.id, videoId),
          eq(catalogProductVideo.productId, productId),
        ),
      )
      .limit(1);
    if (!video || video.status === "deleted")
      throw new NotFoundException("Video not found.");
    return video;
  }
}

function sameProvisionCommand(
  existing: VideoRecord,
  productId: string,
  input: CatalogVideoProvisionInput,
): boolean {
  return (
    existing.productId === productId &&
    existing.fileSizeBytes === input.fileSizeBytes &&
    existing.title === input.title.trim() &&
    existing.description === (input.description?.trim() || null) &&
    (existing.variantColor?.toLocaleLowerCase("en-US") ?? null) ===
      (input.variantColor?.trim().toLocaleLowerCase("en-US") ?? null)
  );
}

function toManagedVideo(video: VideoRecord): CatalogManagedVideo {
  return {
    id: video.id,
    productId: video.productId,
    title: video.title,
    description: video.description,
    variantColor: video.variantColor,
    sortOrder: video.sortOrder,
    status: video.status,
    durationSeconds: numberOrNull(video.durationSeconds),
    captions: parseCaptions(video.captions),
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
  };
}

function parseCaptions(value: unknown): CatalogVideoCaption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((caption) => {
    const parsed = CatalogVideoCaptionSchema.safeParse(caption);
    return parsed.success ? [parsed.data] : [];
  });
}

function providerVideoStatus(
  readyToStream: boolean | undefined,
  state: string | undefined,
): "ready" | "processing" | "awaiting_upload" | "error" {
  if (readyToStream && state === "ready") return "ready";
  if (state === "error") return "error";
  if (state === "pendingupload") return "awaiting_upload";
  return "processing";
}

function safeDurationSeconds(
  duration: number | null | undefined,
): string | null {
  return typeof duration === "number" && duration > 0 && duration <= 36_000
    ? String(duration)
    : null;
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null;
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

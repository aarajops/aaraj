import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  StandardSchemaValidationPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CatalogProductIdSchema,
  CatalogProductSlugSchema,
  CatalogVideoDeleteInputSchema,
  CatalogVideoLanguageSchema,
  CatalogVideoMetadataUpdateInputSchema,
  CatalogVideoOrderInputSchema,
  CatalogVideoProvisionInputSchema,
  MAX_CATALOG_VIDEO_CAPTION_BYTES,
  type CatalogVideoDeleteInput,
  type CatalogVideoMetadataUpdateInput,
  type CatalogVideoOrderInput,
  type CatalogVideoProvisionInput,
} from "@aaraj/contracts";
import type { Request } from "express";
import { ApiCookieAuth } from "@nestjs/swagger";
import { CookieMutationGuard } from "../../platform/authorization/cookie-mutation.guard.js";
import { CatalogVideoService } from "./catalog-video.service.js";

@Controller("catalog/products")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CatalogVideoController {
  constructor(private readonly videos: CatalogVideoService) {}

  @Get("manage/:productId/videos")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
  ) {
    return this.videos.listForManagement(session.user, productId);
  }

  @Post("manage/:productId/videos")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  provisionUpload(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogVideoProvisionInputSchema })
    input: CatalogVideoProvisionInput,
  ) {
    return this.videos.provisionUpload(session.user, productId, input);
  }

  @Patch("manage/:productId/videos/order")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  reorder(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogVideoOrderInputSchema })
    input: CatalogVideoOrderInput,
  ) {
    return this.videos.reorder(session.user, productId, input);
  }

  @Patch("manage/:productId/videos/:videoId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  updateMetadata(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("videoId", { schema: CatalogProductIdSchema }) videoId: string,
    @Body({ schema: CatalogVideoMetadataUpdateInputSchema })
    input: CatalogVideoMetadataUpdateInput,
  ) {
    return this.videos.updateMetadata(session.user, productId, videoId, input);
  }

  @Post("manage/:productId/videos/:videoId/complete")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  completeUpload(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("videoId", { schema: CatalogProductIdSchema }) videoId: string,
  ) {
    return this.videos.completeUpload(session.user, productId, videoId);
  }

  @Post("manage/:productId/videos/:videoId/sync")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  syncStatus(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("videoId", { schema: CatalogProductIdSchema }) videoId: string,
  ) {
    return this.videos.syncStatus(session.user, productId, videoId);
  }

  @Post("manage/:productId/videos/:videoId/captions/:language")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_CATALOG_VIDEO_CAPTION_BYTES,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 64,
      },
    }),
  )
  uploadCaption(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("videoId", { schema: CatalogProductIdSchema }) videoId: string,
    @Param("language", { schema: CatalogVideoLanguageSchema }) language: string,
    @UploadedFile() file: { buffer?: Buffer; size?: number } | undefined,
  ) {
    return this.videos.uploadCaption(
      session.user,
      productId,
      videoId,
      language,
      file,
    );
  }

  @Delete("manage/:productId/videos/:videoId")
  @ApiCookieAuth()
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  delete(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("videoId", { schema: CatalogProductIdSchema }) videoId: string,
    @Body({ schema: CatalogVideoDeleteInputSchema })
    input: CatalogVideoDeleteInput,
  ) {
    return this.videos.delete(session.user, productId, videoId, input);
  }

  @Get(":slug/videos")
  @AllowAnonymous()
  @Header("Cache-Control", "private, no-store")
  listPublished(
    @Param("slug", { schema: CatalogProductSlugSchema }) slug: string,
  ) {
    return this.videos.listPublishedForSlug(slug);
  }
}

@Controller("catalog/videos/webhook")
export class CatalogVideoWebhookController {
  constructor(private readonly videos: CatalogVideoService) {}

  @Post()
  @AllowAnonymous()
  @HttpCode(204)
  receive(@Req() request: Request): Promise<void> {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      throw new Error("Cloudflare Stream webhook raw body is unavailable.");
    }
    const signature = request.headers["webhook-signature"];
    return this.videos.handleWebhook(
      rawBody,
      Array.isArray(signature) ? signature[0] : signature,
    );
  }
}

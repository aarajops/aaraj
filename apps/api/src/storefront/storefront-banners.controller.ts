import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Res,
  StandardSchemaValidationPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiCookieAuth } from "@nestjs/swagger";
import type { Response } from "express";
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
  StorefrontBannerCreateSchema,
  StorefrontBannerListQuerySchema,
  StorefrontBannerAssetUploadSchema,
  StorefrontBannerAssetCursorSchema,
  StorefrontBannerPlacementSchema,
  StorefrontBannerUpdateSchema,
  STOREFRONT_BANNER_CACHE,
  type StorefrontBannerCreate,
  type StorefrontBannerListQuery,
  type StorefrontBannerAssetUpload,
  type StorefrontBannerPlacement,
  type StorefrontBannerUpdate,
} from "@aaraj/contracts";
import { z } from "zod";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import {
  StorefrontAssetManageGuard,
  StorefrontAssetUploadLifecycleInterceptor,
} from "./storefront-asset-upload.guard.js";
import { type StorefrontBannerUploadFile } from "./storefront-banner-image.js";
import { StorefrontBannersService } from "./storefront-banners.service.js";

const BannerAssetIdSchema = z.uuid();
const BannerAssetSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const BannerIdSchema = z.uuid();

@Controller("storefront")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class StorefrontBannersController {
  constructor(private readonly banners: StorefrontBannersService) {}

  @Get("banners/:placement")
  @AllowAnonymous()
  @Header(
    "Cache-Control",
    `public, max-age=0, s-maxage=${STOREFRONT_BANNER_CACHE.revalidateSeconds}, stale-while-revalidate=${STOREFRONT_BANNER_CACHE.staleWhileRevalidateSeconds}`,
  )
  async getPublicBanner(
    @Param("placement", { schema: StorefrontBannerPlacementSchema })
    placement: StorefrontBannerPlacement,
  ) {
    return this.banners.getPublic(placement);
  }

  @Get("banner-assets/:assetId/:sha256.webp")
  @AllowAnonymous()
  async getBannerAsset(
    @Param("assetId", { schema: BannerAssetIdSchema }) assetId: string,
    @Param("sha256", { schema: BannerAssetSha256Schema }) sha256: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.banners.getPublicAsset(assetId, sha256);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("Content-Length", String(asset.body.byteLength));
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${assetId}.webp"`,
    );
    response.status(200).end(asset.body);
  }

  @Get("manage/banner-assets/:assetId/:sha256.webp")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  async getManagedBannerAsset(
    @Session() session: UserSession,
    @Param("assetId", { schema: BannerAssetIdSchema }) assetId: string,
    @Param("sha256", { schema: BannerAssetSha256Schema }) sha256: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.banners.getManagedAsset(
      session.user,
      assetId,
      sha256,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("Content-Length", String(asset.body.byteLength));
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${assetId}.webp"`,
    );
    response.status(200).end(asset.body);
  }

  @Get("manage/banners")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: StorefrontBannerListQuerySchema })
    query: StorefrontBannerListQuery,
  ) {
    return this.banners.listForManagement(session.user, query);
  }

  @Get("manage/banners/:bannerId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  getForManagement(
    @Session() session: UserSession,
    @Param("bannerId", { schema: BannerIdSchema }) bannerId: string,
  ) {
    return this.banners.getForManagement(session.user, bannerId);
  }

  @Post("manage/banners")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  create(
    @Session() session: UserSession,
    @Body({ schema: StorefrontBannerCreateSchema })
    input: StorefrontBannerCreate,
  ) {
    return this.banners.create(session.user, input);
  }

  @Get("manage/banner-assets")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  getManagementAssets(
    @Session() session: UserSession,
    @Query("cursor", {
      schema: StorefrontBannerAssetCursorSchema.optional(),
    })
    cursor?: string,
  ) {
    return this.banners.getAssetPage(session.user, cursor);
  }

  @Post("manage/banner-assets")
  @ApiCookieAuth()
  @ApiConsumes("multipart/form-data")
  @Header("Cache-Control", "no-store")
  @UseGuards(StorefrontAssetManageGuard)
  @UseInterceptors(
    StorefrontAssetUploadLifecycleInterceptor,
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
        files: 1,
        fields: 1,
        parts: 2,
        fieldNameSize: 64,
        fieldSize: 128,
      },
    }),
  )
  uploadAsset(
    @Session() session: UserSession,
    @Body({ schema: StorefrontBannerAssetUploadSchema })
    input: StorefrontBannerAssetUpload,
    @UploadedFile() file: StorefrontBannerUploadFile | undefined,
  ) {
    return this.banners.upload(session.user, input, file);
  }

  @Put("manage/banners/:bannerId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  update(
    @Session() session: UserSession,
    @Param("bannerId", { schema: BannerIdSchema }) bannerId: string,
    @Body({ schema: StorefrontBannerUpdateSchema })
    input: StorefrontBannerUpdate,
  ) {
    return this.banners.update(session.user, bannerId, input);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
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
  StorefrontBrandAssetClearSchema,
  StorefrontBrandAssetKindSchema,
  StorefrontBrandAssetUploadSchema,
  StorefrontSettingsUpdateSchema,
  MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
  type StorefrontBrandAssetClear,
  type StorefrontBrandAssetKind,
  type StorefrontBrandAssetUpload,
  type StorefrontSettingsUpdate,
} from "@aaraj/contracts";
import { z } from "zod";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { StorefrontBrandAssetService } from "./storefront-brand-asset.service.js";
import { type StorefrontBrandUploadFile } from "./storefront-brand-image.js";
import {
  StorefrontAssetManageGuard,
  StorefrontAssetUploadLifecycleInterceptor,
} from "./storefront-asset-upload.guard.js";
import { StorefrontSettingsService } from "./storefront.service.js";

const BrandAssetIdSchema = z.uuid();
const BrandAssetSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const BrandAssetExtensionSchema = z.enum(["png", "webp", "jpg"]);

@Controller("storefront")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class StorefrontController {
  constructor(
    private readonly settings: StorefrontSettingsService,
    private readonly brandAssets: StorefrontBrandAssetService,
  ) {}

  @Get("settings")
  @AllowAnonymous()
  @Header("Cache-Control", "no-store")
  getPublicSettings() {
    return this.settings.getPublicSettings();
  }

  @Get("assets/:assetId/:sha256.:extension")
  @AllowAnonymous()
  async getBrandAsset(
    @Param("assetId", { schema: BrandAssetIdSchema }) assetId: string,
    @Param("sha256", { schema: BrandAssetSha256Schema }) sha256: string,
    @Param("extension", { schema: BrandAssetExtensionSchema })
    extension: "png" | "webp" | "jpg",
    @Query("format", { schema: z.enum(["png"]).optional() })
    format: "png" | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const asset = format
      ? await this.brandAssets.getPublicAssetAsPng(assetId, sha256, extension)
      : await this.brandAssets.getPublicAsset(assetId, sha256, extension);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("Content-Length", String(asset.body.byteLength));
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${assetId}.${format ?? extension}"`,
    );
    response.status(200).end(asset.body);
  }

  @Get("manage/settings")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  getManagementSettings(@Session() session: UserSession) {
    return this.settings.getManagementSettings(session.user);
  }

  @Put("manage/settings")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  updateSettings(
    @Session() session: UserSession,
    @Body({ schema: StorefrontSettingsUpdateSchema })
    input: StorefrontSettingsUpdate,
  ) {
    return this.settings.updateSettings(session.user, input);
  }

  @Post("manage/assets/:kind")
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
        fields: 3,
        parts: 4,
        fieldNameSize: 64,
        fieldSize: 4096,
      },
    }),
  )
  uploadBrandAsset(
    @Session() session: UserSession,
    @Param("kind", { schema: StorefrontBrandAssetKindSchema })
    kind: StorefrontBrandAssetKind,
    @Body({ schema: StorefrontBrandAssetUploadSchema })
    input: StorefrontBrandAssetUpload,
    @UploadedFile() file: StorefrontBrandUploadFile | undefined,
  ) {
    return this.brandAssets.upload(session.user, kind, input, file);
  }

  @Delete("manage/assets/:kind")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  clearBrandAsset(
    @Session() session: UserSession,
    @Param("kind", { schema: StorefrontBrandAssetKindSchema })
    kind: StorefrontBrandAssetKind,
    @Body({ schema: StorefrontBrandAssetClearSchema })
    input: StorefrontBrandAssetClear,
  ) {
    return this.brandAssets.clear(session.user, kind, input);
  }
}

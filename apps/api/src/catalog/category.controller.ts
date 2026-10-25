import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StandardSchemaValidationPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  Res,
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
  CatalogCategoryCreateSchema,
  CatalogCategoryIdSchema,
  CatalogMediaSha256Schema,
  CatalogCategoryUpdateSchema,
  CatalogCategorySlugSuggestionQuerySchema,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
  type CatalogCategoryCreateInput,
  type CatalogCategoryUpdateInput,
  type CatalogCategorySlugSuggestionQuery,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CategoryService } from "./category.service.js";
import { CatalogMediaManageGuard } from "./media/catalog-media.guard.js";
import { RequireCatalogMediaUploadPermission } from "./media/catalog-media.guard.js";
import { CatalogMediaUploadLifecycleInterceptor } from "./media/catalog-media-upload-lifecycle.interceptor.js";
import type { CatalogMediaUploadFile } from "./media/catalog-image-upload.js";

@Controller("catalog/categories")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @AllowAnonymous()
  @Header("Cache-Control", "no-store")
  listPublic() {
    return this.categories.listPublic();
  }

  @Get(":categoryId/image/:sha256.webp")
  @AllowAnonymous()
  async getCategoryImage(
    @Param("categoryId", { schema: CatalogCategoryIdSchema })
    categoryId: string,
    @Param("sha256", { schema: CatalogMediaSha256Schema }) sha256: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.categories.getPublicImage(categoryId, sha256);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", String(image.sizeBytes));
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${categoryId}.webp"`,
    );
    response.status(200).end(image.body);
  }

  @Get("manage")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listForManagement(@Session() session: UserSession) {
    return this.categories.listForManagement(session.user);
  }

  @Get("options/manage")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listOptionsForManagement(@Session() session: UserSession) {
    return this.categories.listOptionsForManagement(session.user);
  }

  @Get("slug-suggestion")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  suggestSlug(
    @Session() session: UserSession,
    @Query({ schema: CatalogCategorySlugSuggestionQuerySchema })
    query: CatalogCategorySlugSuggestionQuery,
  ) {
    return this.categories.suggestSlug(session.user, query.name);
  }

  @Post()
  @ApiCookieAuth()
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogCategoryCreateSchema })
    input: CatalogCategoryCreateInput,
  ) {
    return this.categories.create(session.user, input);
  }

  @Patch(":id")
  @ApiCookieAuth()
  update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogCategoryIdSchema }) categoryId: string,
    @Body({ schema: CatalogCategoryUpdateSchema })
    input: CatalogCategoryUpdateInput,
  ) {
    return this.categories.update(session.user, categoryId, input);
  }

  @Post(":id/image")
  @ApiCookieAuth()
  @ApiConsumes("multipart/form-data")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @UseGuards(CatalogMediaManageGuard)
  @RequireCatalogMediaUploadPermission("catalog.categories.manage")
  @UseInterceptors(
    CatalogMediaUploadLifecycleInterceptor,
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_CATALOG_MEDIA_UPLOAD_BYTES,
        files: 1,
        fields: 0,
        parts: 1,
      },
    }),
  )
  uploadImage(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogCategoryIdSchema }) categoryId: string,
    @UploadedFile() file: CatalogMediaUploadFile | undefined,
  ) {
    return this.categories.uploadImage(session.user, categoryId, file);
  }
}

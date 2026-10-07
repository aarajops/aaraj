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
  Query,
  StandardSchemaValidationPipe,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CatalogProductCreateSchema,
  CatalogProductIdSchema,
  CatalogProductListQuerySchema,
  CatalogMediaDeleteInputSchema,
  CatalogMediaUploadInputSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductSlugSchema,
  CatalogProductUpdateSchema,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
  type CatalogMediaDeleteInput,
  type CatalogMediaUploadInput,
  type CatalogProductCreateInput,
  type CatalogProductListQuery,
  type CatalogPublishedProductListQuery,
  type CatalogProductUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CatalogService } from "./catalog.service.js";
import { CatalogMediaManageGuard } from "./media/catalog-media.guard.js";
import { CatalogMediaUploadLifecycleInterceptor } from "./media/catalog-media-upload-lifecycle.interceptor.js";
import {
  CatalogMediaService,
  type CatalogMediaUploadFile,
} from "./media/catalog-media.service.js";

@Controller("catalog/products")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly catalogMedia: CatalogMediaService,
  ) {}

  @Get("manage")
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: CatalogProductListQuerySchema })
    query: CatalogProductListQuery,
  ) {
    return this.catalog.listForManagement(session.user, query);
  }

  @Get("manage/:id")
  @Header("Cache-Control", "no-store")
  findForManagement(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
  ) {
    return this.catalog.findForManagement(session.user, productId);
  }

  @Get("manage/:productId/media")
  @Header("Cache-Control", "no-store")
  listMediaForManagement(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
  ) {
    return this.catalogMedia.listForManagement(session.user, productId);
  }

  @Post("manage/:productId/media")
  @Header("Cache-Control", "no-store")
  @UseGuards(CatalogMediaManageGuard)
  @UseInterceptors(
    CatalogMediaUploadLifecycleInterceptor,
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_CATALOG_MEDIA_UPLOAD_BYTES,
        files: 1,
        fields: 4,
        parts: 5,
        fieldNameSize: 64,
        fieldSize: 4096,
      },
    }),
  )
  uploadMedia(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogMediaUploadInputSchema })
    input: CatalogMediaUploadInput,
    @UploadedFile() file: CatalogMediaUploadFile | undefined,
  ) {
    return this.catalogMedia.upload(session.user, productId, input, file);
  }

  @Delete("manage/:productId/media/:mediaId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  deleteMedia(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("mediaId", { schema: CatalogProductIdSchema }) mediaId: string,
    @Body({ schema: CatalogMediaDeleteInputSchema })
    input: CatalogMediaDeleteInput,
  ) {
    return this.catalogMedia.delete(session.user, productId, mediaId, input);
  }

  @Get()
  @AllowAnonymous()
  listPublished(
    @Query({ schema: CatalogPublishedProductListQuerySchema })
    query: CatalogPublishedProductListQuery,
  ) {
    return this.catalog.listPublished(query);
  }

  @Get(":slug")
  @AllowAnonymous()
  findPublished(
    @Param("slug", { schema: CatalogProductSlugSchema }) slug: string,
  ) {
    return this.catalog.findPublished(slug);
  }

  @Post()
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogProductCreateSchema })
    input: CatalogProductCreateInput,
  ) {
    return this.catalog.create(session.user, input);
  }

  @Patch(":id")
  update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogProductUpdateSchema })
    input: CatalogProductUpdateInput,
  ) {
    return this.catalog.update(session.user, productId, input);
  }
}

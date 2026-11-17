import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StandardSchemaValidationPipe,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiCookieAuth, ApiHeader, ApiResponse } from "@nestjs/swagger";
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
  CatalogProductMediaOrderInputSchema,
  CatalogMediaUploadInputSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductSlugSchema,
  CatalogProductSlugSuggestionQuerySchema,
  CatalogProductUpdateSchema,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
  type CatalogMediaDeleteInput,
  type CatalogProductMediaOrderInput,
  type CatalogMediaUploadInput,
  type CatalogProductCreateInput,
  type CatalogProductListQuery,
  type CatalogProductSlugSuggestionQuery,
  type CatalogPublishedProductListQuery,
  type CatalogProductUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CatalogService } from "./catalog.service.js";
import {
  catalogEditEtag,
  requireCatalogEditRevision,
} from "./catalog-revision.js";
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
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: CatalogProductListQuerySchema })
    query: CatalogProductListQuery,
  ) {
    return this.catalog.listForManagement(session.user, query);
  }

  @Get("manage/:id")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  async findForManagement(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const product = await this.catalog.findForManagement(
      session.user,
      productId,
    );
    response.setHeader(
      "ETag",
      catalogEditEtag("product", product.id, product.editRevision),
    );
    return product;
  }

  @Get("manage/:productId/media")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listMediaForManagement(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
  ) {
    return this.catalogMedia.listForManagement(session.user, productId);
  }

  @Get("manage/:productId/media/:mediaId/preview")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async previewMediaForManagement(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("mediaId", { schema: CatalogProductIdSchema }) mediaId: string,
  ): Promise<StreamableFile> {
    const image = await this.catalogMedia.getManagementPreview(
      session.user,
      productId,
      mediaId,
    );
    return new StreamableFile(image, {
      type: "image/webp",
      disposition: "inline",
    });
  }

  @Post("manage/:productId/media")
  @ApiCookieAuth()
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

  @Post("manage/:productId/media/:mediaId/retry")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @UseGuards(CatalogMediaManageGuard)
  @UseInterceptors(CatalogMediaUploadLifecycleInterceptor)
  retryMediaUpload(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Param("mediaId", { schema: CatalogProductIdSchema }) mediaId: string,
  ) {
    return this.catalogMedia.retryPendingUpload(
      session.user,
      productId,
      mediaId,
    );
  }

  @Patch("manage/:productId/media/order")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  reorderMedia(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogProductMediaOrderInputSchema })
    input: CatalogProductMediaOrderInput,
  ) {
    return this.catalogMedia.reorder(session.user, productId, input);
  }

  @Delete("manage/:productId/media/:mediaId")
  @ApiCookieAuth()
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

  @Get("filters")
  @AllowAnonymous()
  @Header("Cache-Control", "no-store")
  getPublishedFilters() {
    return this.catalog.getPublishedProductFilterOptions();
  }

  @Get("slug-suggestion")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  suggestSlug(
    @Session() session: UserSession,
    @Query({ schema: CatalogProductSlugSuggestionQuerySchema })
    query: CatalogProductSlugSuggestionQuery,
  ) {
    return this.catalog.suggestSlug(session.user, query.name);
  }

  @Get(":slug")
  @AllowAnonymous()
  findPublished(
    @Param("slug", { schema: CatalogProductSlugSchema }) slug: string,
  ) {
    return this.catalog.findPublished(slug);
  }

  @Post()
  @ApiCookieAuth()
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogProductCreateSchema })
    input: CatalogProductCreateInput,
  ) {
    return this.catalog.create(session.user, input);
  }

  @Patch(":id")
  @ApiCookieAuth()
  @ApiHeader({
    name: "If-Match",
    required: true,
    description:
      "Use the editRevision in the management payload to construct this ETag.",
    example: '"catalog-product:00000000-0000-4000-8000-000000000000:r1"',
  })
  @ApiResponse({
    status: 412,
    description: "The product changed since it was read.",
  })
  @ApiResponse({
    status: 428,
    description: "The If-Match precondition is required.",
  })
  async update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogProductUpdateSchema })
    input: CatalogProductUpdateInput,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const expectedRevision = requireCatalogEditRevision(
      ifMatch,
      "product",
      productId,
    );
    const product = await this.catalog.update(
      session.user,
      productId,
      input,
      expectedRevision,
    );
    response.setHeader(
      "ETag",
      catalogEditEtag("product", product.id, product.editRevision),
    );
    return product;
  }
}

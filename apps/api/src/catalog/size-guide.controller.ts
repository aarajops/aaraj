import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ApiCookieAuth, ApiHeader, ApiResponse } from "@nestjs/swagger";
import type { Response } from "express";
import {
  CatalogSizeGuideCreateSchema,
  CatalogSizeGuideIdSchema,
  CatalogSizeGuideListQuerySchema,
  CatalogSizeGuideUpdateSchema,
  type CatalogSizeGuideCreateInput,
  type CatalogSizeGuideListQuery,
  type CatalogSizeGuideUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { SizeGuideService } from "./size-guide.service.js";
import {
  catalogEditEtag,
  requireCatalogEditRevision,
} from "./catalog-revision.js";

@Controller("catalog/size-guides")
@ApiCookieAuth()
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class SizeGuideController {
  constructor(private readonly sizeGuides: SizeGuideService) {}

  @Get("manage")
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: CatalogSizeGuideListQuerySchema })
    query: CatalogSizeGuideListQuery,
  ) {
    return this.sizeGuides.listForManagement(session.user, query);
  }

  @Get("manage/:id")
  @Header("Cache-Control", "no-store")
  async findForManagement(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogSizeGuideIdSchema }) guideId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const guide = await this.sizeGuides.findForManagement(
      session.user,
      guideId,
    );
    response.setHeader(
      "ETag",
      catalogEditEtag("size-guide", guide.id, guide.editRevision),
    );
    return guide;
  }

  @Post()
  async create(
    @Session() session: UserSession,
    @Body({ schema: CatalogSizeGuideCreateSchema })
    input: CatalogSizeGuideCreateInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const guide = await this.sizeGuides.create(session.user, input);
    response.setHeader(
      "ETag",
      catalogEditEtag("size-guide", guide.id, guide.editRevision),
    );
    return guide;
  }

  @Patch(":id")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description:
      "Strong size-guide ETag returned by a management read or create.",
    example: '"catalog-size-guide:00000000-0000-4000-8000-000000000000:r1"',
  })
  @ApiResponse({
    status: 412,
    description: "The size guide changed since it was read.",
  })
  @ApiResponse({
    status: 428,
    description: "The If-Match precondition is required.",
  })
  async update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogSizeGuideIdSchema }) guideId: string,
    @Body({ schema: CatalogSizeGuideUpdateSchema })
    input: CatalogSizeGuideUpdateInput,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const expectedRevision = requireCatalogEditRevision(
      ifMatch,
      "size-guide",
      guideId,
    );
    const guide = await this.sizeGuides.update(
      session.user,
      guideId,
      input,
      expectedRevision,
    );
    response.setHeader(
      "ETag",
      catalogEditEtag("size-guide", guide.id, guide.editRevision),
    );
    return guide;
  }
}

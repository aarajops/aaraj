import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
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

@Controller("catalog/size-guides")
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
  findForManagement(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogSizeGuideIdSchema }) guideId: string,
  ) {
    return this.sizeGuides.findForManagement(session.user, guideId);
  }

  @Post()
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogSizeGuideCreateSchema })
    input: CatalogSizeGuideCreateInput,
  ) {
    return this.sizeGuides.create(session.user, input);
  }

  @Patch(":id")
  update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogSizeGuideIdSchema }) guideId: string,
    @Body({ schema: CatalogSizeGuideUpdateSchema })
    input: CatalogSizeGuideUpdateInput,
  ) {
    return this.sizeGuides.update(session.user, guideId, input);
  }
}

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
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CatalogProductCreateSchema,
  CatalogProductIdSchema,
  CatalogProductListQuerySchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductSlugSchema,
  CatalogProductUpdateSchema,
  type CatalogProductCreateInput,
  type CatalogProductListQuery,
  type CatalogPublishedProductListQuery,
  type CatalogProductUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CatalogService } from "./catalog.service.js";

@Controller("catalog/products")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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

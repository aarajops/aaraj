import { Can } from "@nestjs/authorization";
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
  CatalogProductSlugSchema,
  CatalogProductUpdateSchema,
  type CatalogProductCreateInput,
  type CatalogProductListQuery,
  type CatalogProductUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { CatalogService } from "./catalog.service.js";

@Controller("catalog/products")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("manage")
  @Header("Cache-Control", "no-store")
  @Can(CatalogPolicy, "manage")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: CatalogProductListQuerySchema })
    query: CatalogProductListQuery,
  ) {
    return this.catalog.listForManagement(session.user, query);
  }

  @Get("manage/:id")
  @Header("Cache-Control", "no-store")
  @Can(CatalogPolicy, "manage")
  findForManagement(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
  ) {
    return this.catalog.findForManagement(session.user, productId);
  }

  @Get()
  @AllowAnonymous()
  listPublished(
    @Query({ schema: CatalogProductListQuerySchema })
    query: CatalogProductListQuery,
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
  @Can(CatalogPolicy, "manage")
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogProductCreateSchema })
    input: CatalogProductCreateInput,
  ) {
    return this.catalog.create(session.user, input);
  }

  @Patch(":id")
  @Can(CatalogPolicy, "manage")
  update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogProductUpdateSchema })
    input: CatalogProductUpdateInput,
  ) {
    return this.catalog.update(session.user, productId, input);
  }
}

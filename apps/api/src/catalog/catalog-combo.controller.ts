import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Put,
  Query,
  Res,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiCookieAuth } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  CatalogComboCandidatesQuerySchema,
  CatalogComboConfigurationInputSchema,
  CatalogProductIdSchema,
  type CatalogComboCandidatesQuery,
  type CatalogComboConfigurationInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CatalogComboService } from "./catalog-combo.service.js";
import {
  catalogEditEtag,
  requireCatalogEditRevision,
} from "./catalog-revision.js";

@Controller("catalog/combos/manage")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CatalogComboController {
  constructor(private readonly combos: CatalogComboService) {}

  @Get("candidates")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  listCandidates(
    @Session() session: UserSession,
    @Query({ schema: CatalogComboCandidatesQuerySchema })
    query: CatalogComboCandidatesQuery,
  ) {
    return this.combos.listCandidates(session.user, query.search);
  }

  @Get(":productId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  async getForManagement(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const combo = await this.combos.getForManagement(session.user, productId);
    if (combo) {
      response.setHeader(
        "ETag",
        catalogEditEtag("product", productId, combo.productRevision),
      );
    }
    return combo;
  }

  @Put(":productId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  async configure(
    @Session() session: UserSession,
    @Param("productId", { schema: CatalogProductIdSchema }) productId: string,
    @Body({ schema: CatalogComboConfigurationInputSchema })
    input: CatalogComboConfigurationInput,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const expectedRevision = requireCatalogEditRevision(
      ifMatch,
      "product",
      productId,
    );
    const combo = await this.combos.configure(
      session.user,
      productId,
      input,
      expectedRevision,
    );
    response.setHeader(
      "ETag",
      catalogEditEtag("product", productId, combo.productRevision),
    );
    return combo;
  }
}

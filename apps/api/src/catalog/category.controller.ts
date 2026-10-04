import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
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
  CatalogCategoryCreateSchema,
  CatalogCategoryIdSchema,
  CatalogCategoryUpdateSchema,
  type CatalogCategoryCreateInput,
  type CatalogCategoryUpdateInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CategoryService } from "./category.service.js";

@Controller("catalog/categories")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @AllowAnonymous()
  listPublic() {
    return this.categories.listPublic();
  }

  @Get("manage")
  @Header("Cache-Control", "no-store")
  listForManagement(@Session() session: UserSession) {
    return this.categories.listForManagement(session.user);
  }

  @Post()
  create(
    @Session() session: UserSession,
    @Body({ schema: CatalogCategoryCreateSchema })
    input: CatalogCategoryCreateInput,
  ) {
    return this.categories.create(session.user, input);
  }

  @Patch(":id")
  update(
    @Session() session: UserSession,
    @Param("id", { schema: CatalogCategoryIdSchema }) categoryId: string,
    @Body({ schema: CatalogCategoryUpdateSchema })
    input: CatalogCategoryUpdateInput,
  ) {
    return this.categories.update(session.user, categoryId, input);
  }
}

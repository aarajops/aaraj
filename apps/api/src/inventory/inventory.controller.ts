import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  InventoryAdjustmentInputSchema,
  InventoryListQuerySchema,
  InventoryVariantIdSchema,
  type InventoryAdjustmentInput,
  type InventoryListQuery,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { InventoryService } from "./inventory.service.js";

@Controller("inventory")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("manage")
  @Header("Cache-Control", "no-store")
  listForManagement(
    @Session() session: UserSession,
    @Query({ schema: InventoryListQuerySchema }) query: InventoryListQuery,
  ) {
    return this.inventory.listForManagement(session.user, query);
  }

  @Get("manage/:variantId")
  @Header("Cache-Control", "no-store")
  findForManagement(
    @Session() session: UserSession,
    @Param("variantId", { schema: InventoryVariantIdSchema }) variantId: string,
  ) {
    return this.inventory.findForManagement(session.user, variantId);
  }

  @Post("manage/:variantId/adjustments")
  adjustStock(
    @Session() session: UserSession,
    @Param("variantId", { schema: InventoryVariantIdSchema }) variantId: string,
    @Body({ schema: InventoryAdjustmentInputSchema })
    input: InventoryAdjustmentInput,
  ) {
    return this.inventory.adjust(session.user, variantId, input);
  }
}

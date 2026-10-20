import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ApiCookieAuth } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  DeliveryTariffUpdateSchema,
  type DeliveryTariffUpdate,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { DeliveryService } from "./delivery.service.js";

@Controller("delivery/manage")
@ApiCookieAuth()
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  getSettings(@Session() session: UserSession) {
    return this.delivery.getManagementSettings(session.user);
  }

  @Put()
  @Header("Cache-Control", "no-store")
  updateSettings(
    @Session() session: UserSession,
    @Body({ schema: DeliveryTariffUpdateSchema }) input: DeliveryTariffUpdate,
  ) {
    return this.delivery.updateManagementSettings(session.user, input);
  }
}

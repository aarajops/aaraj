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
  TaxSettingsUpdateSchema,
  type TaxSettingsUpdate,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { TaxService } from "./tax.service.js";

@Controller("tax/manage")
@ApiCookieAuth()
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  getSettings(@Session() session: UserSession) {
    return this.tax.getManagementSettings(session.user);
  }

  @Put()
  updateSettings(
    @Session() session: UserSession,
    @Body({ schema: TaxSettingsUpdateSchema }) input: TaxSettingsUpdate,
  ) {
    return this.tax.updateSettings(session.user, input);
  }
}

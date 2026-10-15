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
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  StorefrontSettingsUpdateSchema,
  type StorefrontSettingsUpdate,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { StorefrontSettingsService } from "./storefront.service.js";

@Controller("storefront")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class StorefrontController {
  constructor(private readonly settings: StorefrontSettingsService) {}

  @Get("settings")
  @AllowAnonymous()
  @Header("Cache-Control", "no-store")
  getPublicSettings() {
    return this.settings.getPublicSettings();
  }

  @Get("manage/settings")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  getManagementSettings(@Session() session: UserSession) {
    return this.settings.getManagementSettings(session.user);
  }

  @Put("manage/settings")
  @ApiCookieAuth()
  updateSettings(
    @Session() session: UserSession,
    @Body({ schema: StorefrontSettingsUpdateSchema })
    input: StorefrontSettingsUpdate,
  ) {
    return this.settings.updateSettings(session.user, input);
  }
}

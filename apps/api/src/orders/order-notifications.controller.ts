import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import type { Request } from "express";
import {
  OrderIdSchema,
  ResolveOrderNotificationInputSchema,
  type ResolveOrderNotificationInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { OrderNotificationsService } from "./order-notifications.service.js";

@Controller("orders")
@UsePipes(StandardSchemaValidationPipe)
export class OrderNotificationsController {
  constructor(private readonly notifications: OrderNotificationsService) {}

  @Get("manage/notifications/outbox")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  list(@Session() session: UserSession) {
    return this.notifications.list({ id: session.user.id });
  }

  @Patch("manage/notifications/:notificationId/resolve")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  resolve(
    @Session() session: UserSession,
    @Param("notificationId", { schema: OrderIdSchema }) notificationId: string,
    @Body({ schema: ResolveOrderNotificationInputSchema }) input: unknown,
  ) {
    return this.notifications.resolve(
      { id: session.user.id },
      notificationId,
      input as ResolveOrderNotificationInput,
    );
  }

  @Post("notifications/twilio/status")
  @AllowAnonymous()
  @Header("Cache-Control", "no-store")
  async twilioStatus(
    @Req() request: Request,
    @Headers("x-twilio-signature") signature?: string,
    @Query("notificationId") notificationId?: string,
  ): Promise<{ received: true }> {
    if (!signature)
      throw new ForbiddenException("Invalid SMS provider callback.");
    await this.notifications.receiveTwilioStatus(
      request,
      signature,
      notificationId,
    );
    return { received: true };
  }
}

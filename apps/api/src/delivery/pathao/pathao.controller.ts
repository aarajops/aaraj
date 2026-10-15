import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  SignedCookies,
  UnauthorizedException,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import {
  OrderIdSchema,
  PathaoBookingInputSchema,
  PathaoManualReconciliationInputSchema,
  PathaoWebhookResolutionInputSchema,
  type PathaoBookingInput,
  type PathaoManualReconciliationInput,
  type PathaoWebhookResolutionInput,
} from "@aaraj/contracts";
import { OrdersPolicy } from "../../platform/authorization/orders.policy.js";
import { CookieMutationGuard } from "../../platform/authorization/cookie-mutation.guard.js";
import { PathaoService } from "./pathao.service.js";

const PATHAO_INTEGRATION_HEADER =
  "X-Pathao-Merchant-Webhook-Integration-Secret";

@Controller("delivery/pathao/manage")
@ApiCookieAuth()
@Can(OrdersPolicy, "manage")
@UsePipes(StandardSchemaValidationPipe)
export class PathaoManagementController {
  constructor(private readonly pathao: PathaoService) {}

  @Get("stores")
  listStores() {
    return this.pathao.listActiveStores();
  }

  @Get("orders/:orderId")
  @Header("Cache-Control", "no-store")
  getBooking(@Param("orderId", { schema: OrderIdSchema }) orderId: string) {
    return this.pathao.getManagementDetails(orderId);
  }

  @Get("issues")
  @Header("Cache-Control", "no-store")
  getIssues() {
    return this.pathao.getManagementIssues();
  }

  @Post("orders/:orderId/book")
  @UseGuards(CookieMutationGuard)
  createBooking(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Headers("idempotency-key") commandId: string | undefined,
    @Body({ schema: PathaoBookingInputSchema }) input: PathaoBookingInput,
  ) {
    if (!commandId) {
      throw new BadRequestException("An Idempotency-Key header is required.", {
        errorCode: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    return this.pathao.createBooking(
      orderId,
      session.user.id,
      commandId,
      input,
    );
  }

  @Post("orders/:orderId/reconcile")
  @UseGuards(CookieMutationGuard)
  reconcileBooking(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Headers("idempotency-key") commandId: string | undefined,
    @Body({ schema: PathaoManualReconciliationInputSchema })
    input: PathaoManualReconciliationInput,
  ) {
    if (!commandId) {
      throw new BadRequestException("An Idempotency-Key header is required.", {
        errorCode: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    return this.pathao.reconcileBooking(
      orderId,
      session.user.id,
      commandId,
      input,
    );
  }

  @Post("webhooks/:eventId/resolve")
  @UseGuards(CookieMutationGuard)
  resolveWebhookIssue(
    @Session() session: UserSession,
    @Param("eventId", { schema: OrderIdSchema }) eventId: string,
    @Headers("idempotency-key") commandId: string | undefined,
    @Body({ schema: PathaoWebhookResolutionInputSchema })
    input: PathaoWebhookResolutionInput,
  ) {
    if (!commandId) {
      throw new BadRequestException("An Idempotency-Key header is required.", {
        errorCode: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    return this.pathao.resolveWebhookIssue(
      eventId,
      session.user.id,
      commandId,
      input,
    );
  }
}

@OptionalAuth()
@Controller("delivery/pathao/orders")
@UsePipes(StandardSchemaValidationPipe)
export class PathaoCustomerTrackingController {
  constructor(private readonly pathao: PathaoService) {}

  @Get(":orderId/tracking")
  @Header("Cache-Control", "no-store")
  tracking(
    @Session() session: UserSession | undefined,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @SignedCookies() signedCookies: Record<string, string>,
  ) {
    return this.pathao.getCustomerTracking(
      orderId,
      session?.user.id,
      signedCookies,
    );
  }
}

@Controller("delivery/pathao")
@OptionalAuth()
export class PathaoWebhookController {
  constructor(private readonly pathao: PathaoService) {}

  @Post("webhook")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header(PATHAO_INTEGRATION_HEADER, "f3992ecc-59da-4cbe-a049-a13da2018d51")
  async receive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    const contentType = headerValue(headers, "content-type");
    const signature = headerValue(headers, "x-pathao-signature");
    if (
      contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    ) {
      throw new BadRequestException(
        "Pathao webhook must use application/json.",
        {
          errorCode: "PATHAO_WEBHOOK_CONTENT_TYPE_INVALID",
        },
      );
    }
    if (!this.pathao.verifyWebhookSignature(signature)) {
      throw new UnauthorizedException("Pathao webhook authentication failed.", {
        errorCode: "PATHAO_WEBHOOK_UNAUTHENTICATED",
      });
    }
    return this.pathao.acceptWebhook(body);
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];
  return typeof entry === "string" ? entry : undefined;
}

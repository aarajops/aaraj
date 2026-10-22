import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
  SignedCookies,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { HttpAdapterHost } from "@nestjs/core";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CreateOrderInputSchema,
  OrderCancellationInputSchema,
  OrderCollectionInputSchema,
  OrderDispatchCommandIdSchema,
  OrderDispatchInputSchema,
  OrderFulfillmentOutcomeInputSchema,
  OrderIdempotencyKeySchema,
  OrderIdSchema,
  OrderListQuerySchema,
  OrderServiceabilityInputSchema,
  type CreateOrderInput,
  type OrderCancellationInput,
  type OrderCollectionInput,
  type OrderDispatchInput,
  type OrderFulfillmentOutcomeInput,
  type OrderListQuery,
  type OrderServiceabilityInput,
} from "@aaraj/contracts";
import { CART_COOKIE_NAME, getCartCookieOptions } from "../cart/cart-cookie.js";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import {
  OrdersService,
  guestOrderAttemptCookieName,
  guestOrderCookieName,
} from "./orders.service.js";

@OptionalAuth()
@Controller("orders")
@UsePipes(StandardSchemaValidationPipe)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  @Post("checkout-access")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async prepareGuestCheckoutAccess(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @SignedCookies() signedCookies: Record<string, string>,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: unknown,
  ): Promise<void> {
    const parsedKey = OrderIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException(
        "A UUID Idempotency-Key header is required for checkout.",
        { errorCode: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    }
    const credential = await this.orders.prepareGuestCheckoutAccess(
      session?.user.id,
      guestCartId,
      parsedKey.data,
      signedCookies,
    );
    if (credential) {
      this.setGuestAttemptCookie(response, parsedKey.data, credential);
    }
  }

  @Post("checkout/replay")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async replayCheckout(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @SignedCookies() signedCookies: Record<string, string>,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const parsedKey = OrderIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException(
        "A UUID Idempotency-Key is required to resume checkout.",
        { errorCode: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    }
    const result = await this.orders.replayCheckout(
      session?.user.id,
      guestCartId,
      parsedKey.data,
      signedCookies,
    );
    if (result.guestCredential && result.order.guestAccessExpiresAt) {
      this.setGuestOrderCookie(
        response,
        result.order.id,
        result.guestCredential,
        result.order.guestAccessExpiresAt,
      );
      this.clearGuestAttemptCookie(response, parsedKey.data);
    }
    return result.order;
  }

  @Post()
  @Header("Cache-Control", "no-store")
  async create(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @SignedCookies() signedCookies: Record<string, string>,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body({ schema: CreateOrderInputSchema }) input: CreateOrderInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const parsedKey = OrderIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException(
        "A UUID Idempotency-Key header is required for checkout.",
        { errorCode: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    }
    const result = await this.orders.create(
      session?.user.id,
      guestCartId,
      input,
      parsedKey.data,
      signedCookies,
    );
    if (result.guestCredential && result.order.guestAccessExpiresAt) {
      this.setGuestOrderCookie(
        response,
        result.order.id,
        result.guestCredential,
        result.order.guestAccessExpiresAt,
      );
      this.clearGuestAttemptCookie(response, parsedKey.data);
    }
    return result.order;
  }

  @Get("manage")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  listForManagement(
    @Query({ schema: OrderListQuerySchema }) query: OrderListQuery,
  ) {
    return this.orders.listForManagement(query);
  }

  @Get("manage/:orderId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  getForManagement(
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
  ) {
    return this.orders.getForManagement(orderId);
  }

  @Post("manage/:orderId/serviceability")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  reviewServiceability(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderServiceabilityInputSchema })
    input: OrderServiceabilityInput,
  ) {
    return this.orders.reviewServiceability(orderId, session.user.id, input);
  }

  @Post("manage/:orderId/dispatch")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  dispatch(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Headers("idempotency-key") rawCommandId: string | undefined,
    @Body({ schema: OrderDispatchInputSchema }) input: OrderDispatchInput,
  ) {
    const parsedCommandId =
      OrderDispatchCommandIdSchema.safeParse(rawCommandId);
    if (!parsedCommandId.success) {
      throw new BadRequestException(
        "A UUID Idempotency-Key header is required for dispatch.",
        { errorCode: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    }
    return this.orders.dispatch(
      orderId,
      session.user.id,
      parsedCommandId.data.toLowerCase(),
      input,
    );
  }

  @Post("manage/:orderId/cancel")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  cancelAwaitingDispatch(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderCancellationInputSchema })
    input: OrderCancellationInput,
  ) {
    return this.orders.cancelAwaitingDispatch(orderId, session.user.id, input);
  }

  @Post("manage/:orderId/fulfillment-outcome")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  recordFulfillmentOutcome(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderFulfillmentOutcomeInputSchema })
    input: OrderFulfillmentOutcomeInput,
  ) {
    return this.orders.recordFulfillmentOutcome(
      orderId,
      session.user.id,
      input,
    );
  }

  @Post("manage/:orderId/collection")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  recordCodCollection(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderCollectionInputSchema }) input: OrderCollectionInput,
  ) {
    return this.orders.recordCodCollection(orderId, session.user.id, input);
  }

  @Get(":orderId")
  @Header("Cache-Control", "no-store")
  getForOwner(
    @Session() session: UserSession | undefined,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @SignedCookies() signedCookies: Record<string, string>,
  ) {
    return this.orders.getForOwner(orderId, session?.user.id, signedCookies);
  }

  private setGuestOrderCookie(
    response: unknown,
    orderId: string,
    credential: string,
    expiresAt: string,
  ): void {
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) throw new Error("The HTTP adapter is not available.");
    const { maxAge: _maxAge, path: _path, ...options } = getCartCookieOptions();
    adapter.setCookie(response, guestOrderCookieName(orderId), credential, {
      ...options,
      path: `/api/v1/orders/${orderId}`,
      expires: new Date(expiresAt),
      signed: true,
    });
  }

  private setGuestAttemptCookie(
    response: unknown,
    idempotencyKey: string,
    credential: string,
  ): void {
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) throw new Error("The HTTP adapter is not available.");
    const { maxAge: _maxAge, path: _path, ...options } = getCartCookieOptions();
    adapter.setCookie(
      response,
      guestOrderAttemptCookieName(idempotencyKey),
      credential,
      {
        ...options,
        path: "/api/v1/orders",
        signed: true,
      },
    );
  }

  private clearGuestAttemptCookie(
    response: unknown,
    idempotencyKey: string,
  ): void {
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) throw new Error("The HTTP adapter is not available.");
    const { maxAge: _maxAge, path: _path, ...options } = getCartCookieOptions();
    adapter.clearCookie(response, guestOrderAttemptCookieName(idempotencyKey), {
      ...options,
      path: "/api/v1/orders",
    });
  }
}

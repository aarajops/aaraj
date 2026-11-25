import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
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
import { minutes, Throttle } from "@nestjs/throttler";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CreateOrderInputSchema,
  OrderItemAddInputSchema,
  OrderItemRemoveQuerySchema,
  OrderManualDiscountUpdateInputSchema,
  OrderCollectionInputSchema,
  OrderDispatchCommandIdSchema,
  OrderDispatchInputSchema,
  OrderFulfillmentOutcomeInputSchema,
  OrderComboFulfillmentOutcomeInputSchema,
  OrderIdempotencyKeySchema,
  ManualOrderCreateInputSchema,
  ManualOrderInputSchema,
  OrderIdSchema,
  OrderListQuerySchema,
  OrderStatusUpdateInputSchema,
  type CreateOrderInput,
  type OrderItemAddInput,
  type OrderItemRemoveQuery,
  type OrderManualDiscountUpdateInput,
  type OrderCollectionInput,
  type OrderDispatchInput,
  type OrderFulfillmentOutcomeInput,
  type OrderComboFulfillmentOutcomeInput,
  type OrderListQuery,
  type OrderStatusUpdateInput,
  type ManualOrderCreateInput,
  type ManualOrderInput,
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
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
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
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
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
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
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

  @Post("manage/manual/preview")
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  @HttpCode(200)
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  previewManualOrder(
    @Body({ schema: ManualOrderInputSchema }) input: ManualOrderInput,
  ) {
    return this.orders.previewManualOrder(input);
  }

  @Post("manage/manual")
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  createManualOrder(
    @Session() session: UserSession,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body({ schema: ManualOrderCreateInputSchema })
    input: ManualOrderCreateInput,
  ) {
    const parsedKey = OrderIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException(
        "A UUID Idempotency-Key is required to create a manual Order.",
        { errorCode: "IDEMPOTENCY_KEY_REQUIRED" },
      );
    }
    return this.orders.createManualOrder(
      session.user.id,
      input,
      parsedKey.data,
    );
  }

  @Get("manage/:orderId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  getForManagement(
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
  ) {
    return this.orders.getManagementDetail(orderId);
  }

  @Patch("manage/:orderId/items")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  addCatalogItem(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderItemAddInputSchema }) input: OrderItemAddInput,
  ) {
    return this.orders.addCatalogItem(orderId, session.user.id, input);
  }

  @Delete("manage/:orderId/items/:variantId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  removeCatalogItem(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Param("variantId", { schema: OrderIdSchema }) variantId: string,
    @Query({ schema: OrderItemRemoveQuerySchema })
    query: OrderItemRemoveQuery,
  ) {
    return this.orders.removeCatalogItem(
      orderId,
      variantId,
      query.expectedQuantity,
      session.user.id,
    );
  }

  @Patch("manage/:orderId/discount")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  updateManualDiscount(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderManualDiscountUpdateInputSchema })
    input: OrderManualDiscountUpdateInput,
  ) {
    return this.orders.updateManualDiscount(orderId, session.user.id, input);
  }

  @Patch("manage/:orderId/status")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  updateManualStatus(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderStatusUpdateInputSchema })
    input: OrderStatusUpdateInput,
  ) {
    return this.orders.updateManualStatus(orderId, session.user.id, input);
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
        "A UUID Idempotency-Key header is required to record courier pickup.",
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

  @Post("manage/:orderId/combo-fulfillment-outcome")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  recordComboFulfillmentOutcome(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: OrderComboFulfillmentOutcomeInputSchema })
    input: OrderComboFulfillmentOutcomeInput,
  ) {
    return this.orders.recordComboFulfillmentOutcome(
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

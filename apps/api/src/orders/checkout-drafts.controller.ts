import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  SignedCookies,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CheckoutDraftCreateOrderInputSchema,
  CheckoutDraftListQuerySchema,
  CheckoutDraftOutcomeInputSchema,
  CheckoutDraftPreviewInputSchema,
  CheckoutDraftSaveSchema,
  OrderIdSchema,
  type CheckoutDraftCreateOrderInput,
  type CheckoutDraftListQuery,
  type CheckoutDraftOutcomeInput,
  type CheckoutDraftPreviewInput,
  type CheckoutDraftSave,
} from "@aaraj/contracts";
import { CART_COOKIE_NAME } from "../cart/cart-cookie.js";
import { CheckoutDraftsPolicy } from "../platform/authorization/checkout-drafts.policy.js";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { CheckoutDraftsService } from "./checkout-drafts.service.js";
import { OrdersService } from "./orders.service.js";

@OptionalAuth()
@Controller("checkout-drafts")
@UsePipes(StandardSchemaValidationPipe)
export class CheckoutDraftsController {
  constructor(
    private readonly drafts: CheckoutDraftsService,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header("Cache-Control", "no-store")
  save(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Body({ schema: CheckoutDraftSaveSchema }) input: CheckoutDraftSave,
  ) {
    return this.drafts.save(session?.user.id, guestCartId, input);
  }

  @Get()
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(CheckoutDraftsPolicy, "manage")
  list(
    @Query({ schema: CheckoutDraftListQuerySchema })
    query: CheckoutDraftListQuery,
  ) {
    return this.drafts.list(query);
  }

  @Get(":draftId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(CheckoutDraftsPolicy, "manage")
  detail(
    @Session() session: UserSession,
    @Param("draftId", { schema: OrderIdSchema }) id: string,
  ) {
    return this.drafts.detail(id, session.user.id);
  }

  @Post(":draftId/call-outcome")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(CheckoutDraftsPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  outcome(
    @Session() session: UserSession,
    @Param("draftId", { schema: OrderIdSchema }) id: string,
    @Body({ schema: CheckoutDraftOutcomeInputSchema })
    input: CheckoutDraftOutcomeInput,
  ) {
    return this.drafts.outcome(id, session.user.id, input);
  }

  @Post(":draftId/preview")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(CheckoutDraftsPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  preview(
    @Param("draftId", { schema: OrderIdSchema }) id: string,
    @Body({ schema: CheckoutDraftPreviewInputSchema })
    input: CheckoutDraftPreviewInput,
  ) {
    return this.orders.previewDraftOrder(id, input);
  }

  @Post(":draftId/create-order")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(CheckoutDraftsPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  createOrder(
    @Session() session: UserSession,
    @Param("draftId", { schema: OrderIdSchema }) id: string,
    @Body({ schema: CheckoutDraftCreateOrderInputSchema })
    input: CheckoutDraftCreateOrderInput,
  ) {
    return this.orders.createFromDraft(id, session.user.id, input);
  }
}

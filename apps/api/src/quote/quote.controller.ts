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
  UsePipes,
} from "@nestjs/common";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  QuoteDestinationInputSchema,
  QuoteDestinationRefSchema,
  QuoteIdSchema,
  type QuoteDestinationInput,
  type QuoteDestinationRef,
} from "@aaraj/contracts";
import { CART_COOKIE_NAME } from "../cart/cart-cookie.js";
import { QuoteService } from "./quote.service.js";

@OptionalAuth()
@Controller("quotes")
@UsePipes(StandardSchemaValidationPipe)
export class QuoteController {
  constructor(private readonly quotes: QuoteService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Body({ schema: QuoteDestinationInputSchema }) input: QuoteDestinationInput,
  ) {
    return this.quotes.create(session?.user.id, guestCartId, input);
  }

  @Get(":quoteId")
  @Header("Cache-Control", "no-store")
  get(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("quoteId", { schema: QuoteIdSchema }) quoteId: string,
    @Query({ schema: QuoteDestinationRefSchema })
    destination: QuoteDestinationRef,
  ) {
    return this.quotes.get(session?.user.id, guestCartId, quoteId, destination);
  }

  @Get(":quoteId/current")
  @Header("Cache-Control", "no-store")
  getCurrentForCheckout(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("quoteId", { schema: QuoteIdSchema }) quoteId: string,
  ) {
    return this.quotes.getCurrentForCheckout(
      session?.user.id,
      guestCartId,
      quoteId,
    );
  }
}

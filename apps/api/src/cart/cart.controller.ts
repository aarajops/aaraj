import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Put,
  Res,
  SignedCookies,
  StandardSchemaValidationPipe,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  OptionalAuth,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CartAddComboInputSchema,
  CartRevisionQuerySchema,
  CartSetLineInputSchema,
  CartVariantIdSchema,
  type CartRevisionQuery,
  type CartAddComboInput,
  type CartSetLineInput,
} from "@aaraj/contracts";
import { CartService } from "./cart.service.js";
import {
  CART_COOKIE_NAME,
  getCartCookieOptions,
  parseGuestCartId,
} from "./cart-cookie.js";

@OptionalAuth()
@Controller("cart")
@UsePipes(StandardSchemaValidationPipe)
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  getCart(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
  ) {
    return this.cart.getCart(session?.user.id, guestCartId);
  }

  @Delete()
  @Header("Cache-Control", "no-store")
  clearCart(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
  ) {
    return this.cart.clearCart(session?.user.id, guestCartId);
  }

  @Put("lines/:variantId")
  @Header("Cache-Control", "no-store")
  async setLine(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("variantId", { schema: CartVariantIdSchema }) variantId: string,
    @Body({ schema: CartSetLineInputSchema }) input: CartSetLineInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.setLine(
      session?.user.id,
      guestCartId,
      variantId,
      input,
    );
    if (result.guestCartId)
      this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  @Post("combos")
  @Header("Cache-Control", "no-store")
  async addCombo(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Body({ schema: CartAddComboInputSchema }) input: CartAddComboInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.addCombo(
      session?.user.id,
      guestCartId,
      input,
    );
    if (result.guestCartId) {
      this.setGuestCartCookie(response, result.guestCartId);
    }
    return result.cart;
  }

  @Put("combos/:lineId")
  @Header("Cache-Control", "no-store")
  async setComboQuantity(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("lineId", { schema: CartVariantIdSchema }) lineId: string,
    @Body({ schema: CartSetLineInputSchema }) input: CartSetLineInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.setComboQuantity(
      session?.user.id,
      guestCartId,
      lineId,
      input,
    );
    if (result.guestCartId) {
      this.setGuestCartCookie(response, result.guestCartId);
    }
    return result.cart;
  }

  @Delete("combos/:lineId")
  @Header("Cache-Control", "no-store")
  async removeCombo(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("lineId", { schema: CartVariantIdSchema }) lineId: string,
    @Query({ schema: CartRevisionQuerySchema }) input: CartRevisionQuery,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.removeCombo(
      session?.user.id,
      guestCartId,
      lineId,
      input,
    );
    if (result.guestCartId) {
      this.setGuestCartCookie(response, result.guestCartId);
    }
    return result.cart;
  }

  @Delete("lines/:variantId")
  @Header("Cache-Control", "no-store")
  async removeLine(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("variantId", { schema: CartVariantIdSchema }) variantId: string,
    @Query({ schema: CartRevisionQuerySchema }) input: CartRevisionQuery,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.removeLine(
      session?.user.id,
      guestCartId,
      variantId,
      input,
    );
    if (result.guestCartId)
      this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  @Post("merge")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  async mergeGuestCart(
    @Session() session: UserSession | undefined,
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Res({ passthrough: true }) response: unknown,
  ) {
    if (!session?.user.id) {
      throw new UnauthorizedException("Sign in before merging a guest cart.");
    }
    const result = await this.cart.mergeGuestCart(session.user.id, guestCartId);
    if (parseGuestCartId(guestCartId) && !result.guestCartCleanupPending) {
      this.clearGuestCartCookie(response);
    }
    return result;
  }

  @Get("guest")
  @Header("Cache-Control", "no-store")
  getGuestCartForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
  ) {
    return this.cart.getGuestCartForMergeResolution(guestCartId);
  }

  @Delete("guest")
  @Header("Cache-Control", "no-store")
  clearGuestCartForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
  ) {
    return this.cart.clearGuestCartForMergeResolution(guestCartId);
  }

  @Put("guest/combos/:lineId")
  @Header("Cache-Control", "no-store")
  async setGuestComboForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("lineId", { schema: CartVariantIdSchema }) lineId: string,
    @Body({ schema: CartSetLineInputSchema }) input: CartSetLineInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.setComboQuantity(
      undefined,
      guestCartId,
      lineId,
      input,
    );
    if (result.guestCartId)
      this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  @Delete("guest/combos/:lineId")
  @Header("Cache-Control", "no-store")
  async removeGuestComboForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("lineId", { schema: CartVariantIdSchema }) lineId: string,
    @Query({ schema: CartRevisionQuerySchema }) input: CartRevisionQuery,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.removeCombo(
      undefined,
      guestCartId,
      lineId,
      input,
    );
    if (result.guestCartId)
      this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  @Put("guest/lines/:variantId")
  @Header("Cache-Control", "no-store")
  async setGuestLineForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("variantId", { schema: CartVariantIdSchema }) variantId: string,
    @Body({ schema: CartSetLineInputSchema }) input: CartSetLineInput,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.setGuestLineForMergeResolution(
      guestCartId,
      variantId,
      input,
    );
    this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  @Delete("guest/lines/:variantId")
  @Header("Cache-Control", "no-store")
  async removeGuestLineForMergeResolution(
    @SignedCookies(CART_COOKIE_NAME) guestCartId: string | undefined,
    @Param("variantId", { schema: CartVariantIdSchema }) variantId: string,
    @Query({ schema: CartRevisionQuerySchema }) input: CartRevisionQuery,
    @Res({ passthrough: true }) response: unknown,
  ) {
    const result = await this.cart.removeGuestLineForMergeResolution(
      guestCartId,
      variantId,
      input,
    );
    this.setGuestCartCookie(response, result.guestCartId);
    return result.cart;
  }

  private setGuestCartCookie(response: unknown, guestCartId: string): void {
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) throw new Error("The HTTP adapter is not available.");
    adapter.setCookie(response, CART_COOKIE_NAME, guestCartId, {
      ...getCartCookieOptions(),
      signed: true,
    });
  }

  private clearGuestCartCookie(response: unknown): void {
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) throw new Error("The HTTP adapter is not available.");
    adapter.clearCookie(response, CART_COOKIE_NAME, getCartCookieOptions());
  }
}

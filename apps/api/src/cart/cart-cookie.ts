import { createHmac } from "node:crypto";
import type { CookieSerializeOptions } from "@nestjs/common";
import { getStorefrontOrigin } from "../platform/config/storefront-origin.js";

export const CART_COOKIE_NAME = "aaraj_guest_cart";
export const GUEST_CART_TTL_SECONDS = 7 * 24 * 60 * 60;
const GUEST_CART_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function deriveCartCookieSigningSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 bytes.");
  }
  return createHmac("sha256", secret)
    .update("aaraj/cart-cookie-signing/v1")
    .digest("hex");
}

export function getCartCookieOptions(): CookieSerializeOptions {
  const secure = new URL(getStorefrontOrigin()).protocol === "https:";
  if (process.env.NODE_ENV === "production" && !secure) {
    throw new Error("CLIENT_URL must use HTTPS in production.");
  }
  return {
    httpOnly: true,
    maxAge: GUEST_CART_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure,
  };
}

export function parseGuestCartId(value: string | undefined): string | null {
  return value && GUEST_CART_ID_PATTERN.test(value) ? value : null;
}

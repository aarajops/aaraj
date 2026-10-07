import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveCartCookieSigningSecret,
  GUEST_CART_TTL_SECONDS,
  getCartCookieOptions,
  parseGuestCartId,
} from "./cart-cookie.js";

describe("guest cart cookie configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the approved TTL and explicit local cookie protections", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CLIENT_URL", "http://localhost:3000");

    expect(getCartCookieOptions()).toMatchObject({
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(GUEST_CART_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("requires HTTPS for production cookies and validates the signing secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIENT_URL", "https://shop.example");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-long-enough-secret-for-cart-signing");

    expect(getCartCookieOptions().secure).toBe(true);
    expect(deriveCartCookieSigningSecret()).not.toBe(
      "a-long-enough-secret-for-cart-signing",
    );

    vi.stubEnv("CLIENT_URL", "http://shop.example");
    expect(() => getCartCookieOptions()).toThrow(
      "CLIENT_URL must use HTTPS in production.",
    );

    vi.stubEnv("BETTER_AUTH_SECRET", "too-short");
    expect(() => deriveCartCookieSigningSecret()).toThrow(
      "BETTER_AUTH_SECRET must contain at least 32 bytes.",
    );
  });

  it("accepts only opaque high-entropy cart identifiers", () => {
    expect(parseGuestCartId("A".repeat(43))).toBe("A".repeat(43));
    expect(parseGuestCartId("A".repeat(42))).toBeNull();
    expect(parseGuestCartId("A".repeat(42) + ".")).toBeNull();
    expect(parseGuestCartId(undefined)).toBeNull();
  });
});

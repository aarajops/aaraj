import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPathaoConfiguration } from "../src/delivery/pathao/pathao-config.js";

const tokenEncryptionKey = randomBytes(32).toString("base64url");
const sandboxEnvironment: NodeJS.ProcessEnv = {
  PATHAO_BASE_URL: "https://courier-api-sandbox.pathao.com",
  PATHAO_DELIVERY_TYPE: "48",
  PATHAO_TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  PATHAO_SANDBOX_CLIENT_ID: "test-client-id",
  PATHAO_SANDBOX_CLIENT_SECRET: "test-client-secret",
  PATHAO_SANDBOX_USERNAME: "test@example.invalid",
  PATHAO_SANDBOX_PASSWORD: "test-password",
  PATHAO_SANDBOX_WEBHOOK_SECRET: "test-webhook-secret",
};

describe("Pathao configuration", () => {
  it("is unconfigured when the Pathao base URL and credentials are absent", () => {
    expect(readPathaoConfiguration({})).toBeNull();
  });

  it("rejects credentials without a base URL instead of silently ignoring them", () => {
    expect(() =>
      readPathaoConfiguration({
        PATHAO_SANDBOX_CLIENT_SECRET: "stale-secret",
      }),
    ).toThrow("PATHAO_BASE_URL");
  });

  it("uses the documented sandbox base URL and its credentials", () => {
    expect(readPathaoConfiguration(sandboxEnvironment)).toMatchObject({
      mode: "sandbox",
      baseUrl: "https://courier-api-sandbox.pathao.com",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      username: "test@example.invalid",
      password: "test-password",
      webhookSecret: "test-webhook-secret",
      deliveryType: 48,
    });
  });

  it("uses the documented live base URL and does not require AARAJ-only approval flags", () => {
    expect(
      readPathaoConfiguration({
        PATHAO_BASE_URL: "https://api-hermes.pathao.com",
        PATHAO_DELIVERY_TYPE: "48",
        PATHAO_TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
        PATHAO_LIVE_CLIENT_ID: "test-live-client-id",
        PATHAO_LIVE_CLIENT_SECRET: "test-live-client-secret",
        PATHAO_LIVE_USERNAME: "test-live@example.invalid",
        PATHAO_LIVE_PASSWORD: "test-live-password",
        PATHAO_LIVE_WEBHOOK_SECRET: "test-live-webhook-secret",
      }),
    ).toMatchObject({
      mode: "live",
      baseUrl: "https://api-hermes.pathao.com",
      clientId: "test-live-client-id",
      deliveryType: 48,
    });
  });

  it("accepts only the two Pathao-documented base URLs", () => {
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_BASE_URL: "https://attacker.example",
      }),
    ).toThrow("PATHAO_BASE_URL");
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_BASE_URL: "https://courier-api-sandbox.pathao.com/extra",
      }),
    ).toThrow("PATHAO_BASE_URL");
  });

  it("accepts only one documented delivery_type code from configuration", () => {
    expect(
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_DELIVERY_TYPE: "12",
      })?.deliveryType,
    ).toBe(12);
    for (const value of [undefined, "", "48,12", " 48", "13"]) {
      expect(() =>
        readPathaoConfiguration({
          ...sandboxEnvironment,
          PATHAO_DELIVERY_TYPE: value,
        }),
      ).toThrow("PATHAO_DELIVERY_TYPE");
    }
  });

  it("requires the credentials and persistent token encryption key while configured", () => {
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_SANDBOX_PASSWORD: "",
      }),
    ).toThrow("PATHAO_SANDBOX_PASSWORD");
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_TOKEN_ENCRYPTION_KEY: "",
      }),
    ).toThrow("PATHAO_TOKEN_ENCRYPTION_KEY");
  });
});

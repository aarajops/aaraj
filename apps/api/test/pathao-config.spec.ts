import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPathaoConfiguration } from "../src/delivery/pathao/pathao-config.js";

const orderPiiEncryptionKey = randomBytes(32).toString("base64url");
const sandboxEnvironment: NodeJS.ProcessEnv = {
  PATHAO_BASE_URL: "https://courier-api-sandbox.pathao.com",
  ORDER_PII_ENCRYPTION_KEY: orderPiiEncryptionKey,
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
    });
  });

  it("uses the documented live base URL and merchant credentials", () => {
    const liveEnvironment: NodeJS.ProcessEnv = {
      PATHAO_BASE_URL: "https://api-hermes.pathao.com",
      ORDER_PII_ENCRYPTION_KEY: orderPiiEncryptionKey,
      PATHAO_LIVE_CLIENT_ID: "test-live-client-id",
      PATHAO_LIVE_CLIENT_SECRET: "test-live-client-secret",
      PATHAO_LIVE_USERNAME: "test-live@example.invalid",
      PATHAO_LIVE_PASSWORD: "test-live-password",
      PATHAO_LIVE_WEBHOOK_SECRET: "test-live-webhook-secret",
    };
    expect(readPathaoConfiguration(liveEnvironment)).toMatchObject({
      mode: "live",
      baseUrl: "https://api-hermes.pathao.com",
      clientId: "test-live-client-id",
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

  it("requires the credentials and existing application encryption key while configured", () => {
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_SANDBOX_PASSWORD: "",
      }),
    ).toThrow("PATHAO_SANDBOX_PASSWORD");
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        ORDER_PII_ENCRYPTION_KEY: "",
      }),
    ).toThrow("ORDER_PII_ENCRYPTION_KEY");
  });
});

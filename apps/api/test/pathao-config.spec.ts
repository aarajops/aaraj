import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPathaoConfiguration } from "../src/delivery/pathao/pathao-config.js";

const orderPiiEncryptionKey = randomBytes(32).toString("base64url");
const liveEnvironment: NodeJS.ProcessEnv = {
  ORDER_PII_ENCRYPTION_KEY: orderPiiEncryptionKey,
  PATHAO_CLIENT_ID: "test-client-id",
  PATHAO_CLIENT_SECRET: "test-client-secret",
  PATHAO_USERNAME: "test@example.invalid",
  PATHAO_PASSWORD: "test-password",
  PATHAO_WEBHOOK_SECRET: "test-webhook-secret",
};

describe("Pathao configuration", () => {
  it("is unconfigured when Pathao credentials are absent", () => {
    expect(readPathaoConfiguration({})).toBeNull();
  });

  it("uses only the production endpoint and merchant credentials", () => {
    expect(readPathaoConfiguration(liveEnvironment)).toMatchObject({
      mode: "live",
      baseUrl: "https://api-hermes.pathao.com",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      username: "test@example.invalid",
      password: "test-password",
      webhookSecret: "test-webhook-secret",
    });
  });

  it("requires all merchant credentials and the existing application encryption key", () => {
    expect(() =>
      readPathaoConfiguration({
        ...liveEnvironment,
        PATHAO_PASSWORD: "",
      }),
    ).toThrow("PATHAO_PASSWORD");
    expect(() =>
      readPathaoConfiguration({
        ...liveEnvironment,
        ORDER_PII_ENCRYPTION_KEY: "",
      }),
    ).toThrow("ORDER_PII_ENCRYPTION_KEY");
  });
});

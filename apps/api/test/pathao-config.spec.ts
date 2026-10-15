import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPathaoConfiguration } from "../src/delivery/pathao/pathao-config.js";

const tokenEncryptionKey = randomBytes(32).toString("base64url");
const sandboxEnvironment: NodeJS.ProcessEnv = {
  PATHAO_MODE: "sandbox",
  PATHAO_DELIVERY_TYPE: "48",
  PATHAO_TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  PATHAO_SANDBOX_CLIENT_ID: "test-client-id",
  PATHAO_SANDBOX_CLIENT_SECRET: "test-client-secret",
  PATHAO_SANDBOX_USERNAME: "test@example.invalid",
  PATHAO_SANDBOX_PASSWORD: "test-password",
  PATHAO_SANDBOX_WEBHOOK_SECRET: "test-webhook-secret",
  PATHAO_SANDBOX_APPROVED_STORE_IDS: "101,102",
};

describe("Pathao configuration", () => {
  it("is disabled by default without requiring credentials", () => {
    expect(readPathaoConfiguration({})).toBeNull();
  });

  it("selects the fixed sandbox host and validates approved store IDs", () => {
    const configuration = readPathaoConfiguration({
      ...sandboxEnvironment,
      PATHAO_BASE_URL: "https://attacker.example",
    });
    expect(configuration).toMatchObject({
      mode: "sandbox",
      baseUrl: "https://courier-api-sandbox.pathao.com",
      deliveryType: 48,
      approvedStoreIds: new Set([101, 102]),
    });
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

  it("requires nonempty, valid sandbox store IDs", () => {
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_SANDBOX_APPROVED_STORE_IDS: "",
      }),
    ).toThrow("PATHAO_SANDBOX_APPROVED_STORE_IDS");
    expect(() =>
      readPathaoConfiguration({
        ...sandboxEnvironment,
        PATHAO_SANDBOX_APPROVED_STORE_IDS: "101,101",
      }),
    ).toThrow("duplicate IDs");
  });

  it("blocks live use until credentials are rotated and the password-grant exception is approved", () => {
    const liveEnvironment: NodeJS.ProcessEnv = {
      PATHAO_MODE: "live",
      PATHAO_DELIVERY_TYPE: "48",
      PATHAO_TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      PATHAO_LIVE_CLIENT_ID: "test-live-client-id",
      PATHAO_LIVE_CLIENT_SECRET: "test-live-client-secret",
      PATHAO_LIVE_USERNAME: "test-live@example.invalid",
      PATHAO_LIVE_PASSWORD: "test-live-password",
      PATHAO_LIVE_WEBHOOK_SECRET: "test-live-webhook-secret",
      PATHAO_LIVE_APPROVED_STORE_IDS: "201",
    };
    expect(() => readPathaoConfiguration(liveEnvironment)).toThrow(
      "Pathao live credentials must be rotated before activation.",
    );
    expect(() =>
      readPathaoConfiguration({
        ...liveEnvironment,
        PATHAO_LIVE_CREDENTIALS_ROTATED: "true",
      }),
    ).toThrow(
      "Pathao's documented password grant requires explicit production approval.",
    );
    expect(
      readPathaoConfiguration({
        ...liveEnvironment,
        PATHAO_LIVE_CREDENTIALS_ROTATED: "true",
        PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED: "true",
      }),
    ).toMatchObject({
      mode: "live",
      baseUrl: "https://api-hermes.pathao.com",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { R2Storage } from "../src/catalog/media/r2-storage.js";

const productionConfiguration = {
  NODE_ENV: "production",
  R2_ACCOUNT_ID: "00000000000000000000000000000000",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "aaraj-media",
} as const;

describe("R2 storage configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("initializes in production without timeout environment variables", () => {
    for (const [name, value] of Object.entries(productionConfiguration)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("R2_CONNECTION_TIMEOUT_MS", "");
    vi.stubEnv("R2_REQUEST_TIMEOUT_MS", "");
    vi.stubEnv("R2_RESPONSE_BODY_TIMEOUT_MS", "");
    const storage = new R2Storage();

    expect(() => storage.onModuleInit()).not.toThrow();
    storage.onApplicationShutdown();
  });
});

import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadLocalEnvironment } from "../src/platform/config/local-environment.js";
import { R2Storage } from "../src/catalog/media/r2-storage.js";

loadLocalEnvironment();

describe("live R2 media adapter", () => {
  const storage = new R2Storage();

  afterAll(() => storage.onApplicationShutdown());

  it("writes, reads, verifies, and deletes an isolated temporary object", async () => {
    const body = Buffer.from(`aaraj-r2-adapter-check:${randomUUID()}`);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const key = `integration-checks/${randomUUID()}/probe.webp`;

    try {
      await storage.putQuarantinedObject({
        key,
        body,
        contentType: "image/webp",
        sha256,
      });

      await expect(
        storage.getPublishedDerivative({
          key,
          sha256,
          sizeBytes: body.byteLength,
        }),
      ).resolves.toEqual(body);
    } finally {
      await storage.deleteMediaObjects([key]);
    }
  });
});

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
    const mediaId = randomUUID();
    const sourceKey = `quarantine/${mediaId}/source`;
    const derivativeKey = `published/${mediaId}/${sha256}.webp`;

    try {
      await storage.putQuarantinedObject({
        key: sourceKey,
        body,
        contentType: "image/webp",
        sha256,
      });
      await expect(
        storage.getQuarantinedObject({
          key: sourceKey,
          sha256,
          sizeBytes: body.byteLength,
        }),
      ).resolves.toEqual(body);

      await storage.putDerivativeObject({
        key: derivativeKey,
        body,
        sha256,
      });
      await expect(
        storage.getPublishedDerivative({
          key: derivativeKey,
          sha256,
          sizeBytes: body.byteLength,
        }),
      ).resolves.toEqual(body);

      const listed = await storage.listCatalogMediaObjectsForId(mediaId);
      expect(listed.sort()).toEqual([derivativeKey, sourceKey].sort());
      const page = await storage.listCatalogMediaObjectsPage({
        prefix: "quarantine/",
        maxKeys: 100,
      });
      expect(
        page.objects.find(({ key }) => key === sourceKey)?.lastModified,
      ).toBeInstanceOf(Date);
    } finally {
      await storage.deleteMediaObjects([sourceKey, derivativeKey]);
    }
  });
});

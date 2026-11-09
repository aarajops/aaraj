import { afterEach, describe, expect, it, vi } from "vitest";
import type { PathaoConfiguration } from "./pathao-config.js";
import { PathaoApiClient } from "./pathao-api.client.js";

const config = {
  baseUrl: "https://api-hermes.pathao.com",
} as PathaoConfiguration;

describe("PathaoApiClient response handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a response stream failure as provider unavailability", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("connection reset"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );

    await expect(
      new PathaoApiClient().issueToken(config, { type: "password" }),
    ).rejects.toMatchObject({ code: "PATHAO_NETWORK_UNAVAILABLE" });
  });

  it("rejects a missing response body as an invalid provider response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(
      new PathaoApiClient().issueToken(config, { type: "password" }),
    ).rejects.toMatchObject({ code: "PATHAO_RESPONSE_INVALID" });
  });

  it("rejects an oversized response without parsing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("x".repeat(64 * 1024 + 1), { status: 200 }),
        ),
    );

    await expect(
      new PathaoApiClient().issueToken(config, { type: "password" }),
    ).rejects.toMatchObject({ code: "PATHAO_RESPONSE_TOO_LARGE" });
  });

  it("reports the HTTP status without reading an unneeded error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("x".repeat(64 * 1024 + 1), { status: 503 }),
        ),
    );

    await expect(
      new PathaoApiClient().issueToken(config, { type: "password" }),
    ).rejects.toMatchObject({
      code: "PATHAO_HTTP_503",
      httpStatus: 503,
    });
  });
});

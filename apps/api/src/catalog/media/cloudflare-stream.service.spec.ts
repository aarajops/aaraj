import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareStreamService,
  readStreamUploadKeyring,
} from "./cloudflare-stream.service.js";

const accountId = "0123456789abcdef0123456789abcdef";
const webhookSecret = "stream-webhook-test-secret-32-bytes";
const encryptionKey = randomBytes(32).toString("base64url");

describe("Cloudflare Stream integration security", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("encrypts retriable upload URLs with video-bound associated data", () => {
    setEnvironment();
    const stream = new CloudflareStreamService();
    const envelope = stream.encryptUploadUrl(
      "https://upload.videodelivery.net/0123456789abcdef0123456789abcdef",
      "6d8b9a41-c163-4d8d-95d4-98de0f832abc",
    );
    expect(envelope).not.toContain("upload.videodelivery.net");
    expect(
      stream.decryptUploadUrl(envelope, "6d8b9a41-c163-4d8d-95d4-98de0f832abc"),
    ).toBe("https://upload.videodelivery.net/0123456789abcdef0123456789abcdef");
    expect(() =>
      stream.decryptUploadUrl(envelope, "a9f12a1c-cc3a-4de2-a126-af30296b515f"),
    ).toThrow();
  });

  it("keeps old video upload encryption keys readable during rotation", () => {
    const oldKey = randomBytes(32).toString("base64url");
    const activeKey = randomBytes(32).toString("base64url");
    const keyring = readStreamUploadKeyring({
      CLOUDFLARE_STREAM_UPLOAD_KEYRING: JSON.stringify({
        activeKeyId: "new-key",
        keys: { "old-key": oldKey, "new-key": activeKey },
      }),
    });
    expect(keyring.activeKeyId).toBe("new-key");
    expect(keyring.keys.get("old-key")?.byteLength).toBe(32);
  });

  it("verifies the exact raw webhook bytes, timestamp window, and signature", () => {
    setEnvironment();
    const stream = new CloudflareStreamService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from(
      '{"uid":"0123456789abcdef0123456789abcdef","readyToStream":true}\n',
    );
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    const header = `time=${timestamp},sig1=${signature}`;

    expect(stream.verifyWebhook(body, header)).toBe(true);
    expect(
      stream.verifyWebhook(Buffer.from(body.toString().trim()), header),
    ).toBe(false);
    expect(stream.verifyWebhook(body, `time=1,sig1=${signature}`)).toBe(false);
    expect(
      stream.verifyWebhook(body, `time=${timestamp},sig1=${"0".repeat(64)}`),
    ).toBe(false);
  });

  it("requests a private resumable upload with a bounded duration and expiry", async () => {
    setEnvironment();
    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        expect(url.href).toBe(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
        );
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe(
          "Bearer test-stream-api-token",
        );
        expect(headers.get("Tus-Resumable")).toBe("1.0.0");
        expect(headers.get("Upload-Length")).toBe("250000000");
        const metadata = parseTusMetadata(headers.get("Upload-Metadata") ?? "");
        expect(metadata.get("requiresignedurls")).toBe("");
        expect(
          Buffer.from(
            metadata.get("maxDurationSeconds") ?? "",
            "base64",
          ).toString(),
        ).toBe("180");
        expect(
          JSON.parse(
            Buffer.from(
              metadata.get("allowedorigins") ?? "",
              "base64",
            ).toString(),
          ),
        ).toEqual(["shop.example"]);
        expect(
          new Date(
            Buffer.from(metadata.get("expiry") ?? "", "base64").toString(),
          ).getTime(),
        ).toBeGreaterThan(Date.now());
        return new Response(null, {
          status: 201,
          headers: {
            Location:
              "https://upload.videodelivery.net/0123456789abcdef0123456789abcdef",
            "stream-media-id": "0123456789abcdef0123456789abcdef",
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CLIENT_URL", "https://shop.example");

    const upload = await new CloudflareStreamService().createTusUpload({
      fileSizeBytes: 250_000_000,
      title: "Black tee turntable",
      actorId: "staff-user-id",
      productId: "32e44ec2-f055-4b2e-b970-1ef962db69a6",
      videoId: "a93cc59c-8cdd-4db7-a039-5f2f99722366",
    });
    expect(upload.providerUid).toBe("0123456789abcdef0123456789abcdef");
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function setEnvironment() {
  vi.stubEnv("CLOUDFLARE_STREAM_ACCOUNT_ID", accountId);
  vi.stubEnv("CLOUDFLARE_STREAM_API_TOKEN", "test-stream-api-token");
  vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", webhookSecret);
  vi.stubEnv("CLOUDFLARE_STREAM_UPLOAD_ENCRYPTION_KEY", encryptionKey);
  vi.stubEnv("CLIENT_URL", "https://shop.example");
}

function parseTusMetadata(value: string): Map<string, string> {
  return new Map(
    value.split(",").map((pair) => {
      const separator = pair.indexOf(" ");
      return separator < 0
        ? [pair, ""]
        : [pair.slice(0, separator), pair.slice(separator + 1)];
    }),
  );
}

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Buffer } from "node:buffer";
import {
  CatalogVideoCaptionSchema,
  MAX_CATALOG_VIDEO_DURATION_SECONDS,
  type CatalogVideoCaption,
} from "@aaraj/contracts";
import { getStorefrontOrigin } from "../../platform/config/storefront-origin.js";

const STREAM_API_ORIGIN = "https://api.cloudflare.com/client/v4";
const STREAM_UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;
const STREAM_TOKEN_CACHE_MS = 50 * 60 * 1000;
const STREAM_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const MAX_STREAM_API_RESPONSE_BYTES = 1_048_576;

type StreamConfiguration = {
  accountId: string;
  apiToken: string;
  webhookSecret: string;
  uploadEncryptionKeyring: StreamUploadKeyring;
};

type StreamUploadKeyring = {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

type StreamApiEnvelope<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type StreamTusUpload = {
  uploadUrl: string;
  providerUid: string;
  expiresAt: Date;
};

type StreamVideoDetails = {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string; pctComplete?: string };
  duration?: number;
};

@Injectable()
export class CloudflareStreamService {
  private readonly logger = new Logger(CloudflareStreamService.name);
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  configuration(
    environment: NodeJS.ProcessEnv = process.env,
  ): StreamConfiguration {
    const accountId = environment.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim();
    if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
      throw new ServiceUnavailableException({
        message: "Catalog video management is not configured.",
        errorCode: "CATALOG_VIDEO_PROVIDER_UNAVAILABLE",
      });
    }
    const apiToken = environment.CLOUDFLARE_STREAM_API_TOKEN?.trim();
    const webhookSecret = environment.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim();
    if (!apiToken || !webhookSecret) {
      throw new ServiceUnavailableException({
        message: "Catalog video management is not configured.",
        errorCode: "CATALOG_VIDEO_PROVIDER_UNAVAILABLE",
      });
    }
    let uploadEncryptionKeyring: StreamUploadKeyring;
    try {
      uploadEncryptionKeyring = readStreamUploadKeyring(environment);
    } catch {
      throw new ServiceUnavailableException({
        message: "Catalog video management is not configured.",
        errorCode: "CATALOG_VIDEO_PROVIDER_UNAVAILABLE",
      });
    }
    return { accountId, apiToken, webhookSecret, uploadEncryptionKeyring };
  }

  async createTusUpload(input: {
    fileSizeBytes: number;
    title: string;
    actorId: string;
    productId: string;
    videoId: string;
  }): Promise<StreamTusUpload> {
    const configuration = this.configuration();
    const expiresAt = new Date(Date.now() + STREAM_UPLOAD_TTL_MS);
    const allowedOrigins = [new URL(getStorefrontOrigin()).host];
    const metadata = [
      `name ${base64(input.title)}`,
      `maxDurationSeconds ${base64(String(MAX_CATALOG_VIDEO_DURATION_SECONDS))}`,
      `expiry ${base64(expiresAt.toISOString())}`,
      "requiresignedurls",
      `allowedorigins ${base64(JSON.stringify(allowedOrigins))}`,
      `meta ${base64(JSON.stringify({ productId: input.productId, videoId: input.videoId }))}`,
    ].join(",");
    const url = new URL(
      `/client/v4/accounts/${configuration.accountId}/stream?direct_user=true`,
      "https://api.cloudflare.com",
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuration.apiToken}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(input.fileSizeBytes),
          "Upload-Metadata": metadata,
          "Upload-Creator": input.actorId.slice(0, 64),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(
        `Cloudflare Stream TUS provisioning failed: ${errorName(error)}`,
      );
      throw this.providerUnavailable();
    }
    const uploadUrl = response.headers.get("location");
    const providerUid = response.headers.get("stream-media-id");
    if (
      !response.ok ||
      !uploadUrl ||
      !providerUid ||
      !isValidStreamUid(providerUid) ||
      !isValidUploadUrl(uploadUrl)
    ) {
      await discardResponse(response);
      this.logger.warn(
        "Cloudflare Stream returned an invalid TUS upload response.",
      );
      throw this.providerUnavailable();
    }
    await discardResponse(response);
    return { uploadUrl, providerUid, expiresAt };
  }

  encryptUploadUrl(uploadUrl: string, videoId: string): string {
    const keyring = this.configuration().uploadEncryptionKeyring;
    const key = keyring.keys.get(keyring.activeKeyId);
    if (!key)
      throw new Error("The active Stream upload encryption key is missing.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`catalog-video-upload/v1/${videoId}`, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(uploadUrl, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v2.${keyring.activeKeyId}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  decryptUploadUrl(envelope: string, videoId: string): string {
    const keyring = this.configuration().uploadEncryptionKeyring;
    const match =
      /^v2\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/.exec(
        envelope,
      );
    if (!match) throw new Error("Invalid catalog video upload URL envelope.");
    const [, keyId, encodedIv, encodedTag, encodedCiphertext] = match;
    const key = keyId ? keyring.keys.get(keyId) : undefined;
    if (!key || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error("Invalid catalog video upload URL envelope.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`catalog-video-upload/v1/${videoId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const webhookSecret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) return false;
    if (!signatureHeader || rawBody.byteLength === 0) return false;
    const fields = new Map(
      signatureHeader.split(",").map((part) => {
        const separator = part.indexOf("=");
        return separator < 0
          ? [part, ""]
          : [part.slice(0, separator), part.slice(separator + 1)];
      }),
    );
    const timestamp = fields.get("time");
    const signature = fields.get("sig1");
    if (
      !timestamp ||
      !/^\d{1,12}$/.test(timestamp) ||
      !signature ||
      !/^[a-f0-9]{64}$/i.test(signature)
    ) {
      return false;
    }
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (age > STREAM_WEBHOOK_TOLERANCE_SECONDS) return false;
    const expected = createHmac("sha256", webhookSecret)
      .update(timestamp)
      .update(".")
      .update(rawBody)
      .digest();
    const supplied = Buffer.from(signature, "hex");
    return (
      supplied.length === expected.length && timingSafeEqual(expected, supplied)
    );
  }

  async getVideo(providerUid: string): Promise<StreamVideoDetails> {
    return this.apiRequest<StreamVideoDetails>(`/${providerUid}`, {
      method: "GET",
    });
  }

  async deleteVideo(providerUid: string): Promise<void> {
    const response = await this.apiFetch(`/${providerUid}`, {
      method: "DELETE",
    });
    if (response.status === 404) {
      await discardResponse(response);
      return;
    }
    await assertStreamSuccess(response);
  }

  async getPlaybackUrl(providerUid: string): Promise<string> {
    const cached = this.tokenCache.get(providerUid);
    if (cached && cached.expiresAt > Date.now()) {
      return `https://iframe.videodelivery.net/${cached.token}`;
    }
    const response = await this.apiRequest<{ token?: string }>(
      `/${providerUid}/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!response.token || response.token.length > 4096) {
      throw this.providerUnavailable();
    }
    this.tokenCache.set(providerUid, {
      token: response.token,
      expiresAt: Date.now() + STREAM_TOKEN_CACHE_MS,
    });
    return `https://iframe.videodelivery.net/${response.token}`;
  }

  async uploadCaption(
    providerUid: string,
    language: string,
    bytes: Buffer,
  ): Promise<CatalogVideoCaption[]> {
    const form = new FormData();
    const captionBytes = new Uint8Array(bytes.byteLength);
    captionBytes.set(bytes);
    form.set(
      "file",
      new Blob([captionBytes], { type: "text/vtt" }),
      "captions.vtt",
    );
    await assertStreamSuccess(
      await this.apiFetch(
        `/captions/${encodeURIComponent(language)}`,
        {
          method: "PUT",
          body: form,
        },
        providerUid,
      ),
    );
    return this.listCaptions(providerUid);
  }

  async listCaptions(providerUid: string): Promise<CatalogVideoCaption[]> {
    const result = await this.apiRequest<unknown>(
      "/captions",
      { method: "GET" },
      providerUid,
    );
    if (!Array.isArray(result)) return [];
    return result.flatMap((caption) => {
      const parsed = CatalogVideoCaptionSchema.safeParse(caption);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private async apiRequest<T>(
    suffix: string,
    init: RequestInit,
    providerUid?: string,
  ): Promise<T> {
    const response = await this.apiFetch(suffix, init, providerUid);
    const envelope = await readEnvelope<T>(response);
    if (
      !response.ok ||
      envelope.success !== true ||
      envelope.result === undefined
    ) {
      this.logger.warn("Cloudflare Stream API request failed.");
      throw this.providerUnavailable();
    }
    return envelope.result;
  }

  private async apiFetch(
    suffix: string,
    init: RequestInit,
    providerUid?: string,
  ): Promise<Response> {
    const configuration = this.configuration();
    const path = providerUid
      ? `${configuration.accountId}/stream/${providerUid}${suffix}`
      : `${configuration.accountId}/stream${suffix}`;
    const url = new URL(path, `${STREAM_API_ORIGIN}/`);
    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${configuration.apiToken}`);
      return await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(`Cloudflare Stream request failed: ${errorName(error)}`);
      throw this.providerUnavailable();
    }
  }

  private providerUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: "The video provider is temporarily unavailable.",
      errorCode: "CATALOG_VIDEO_PROVIDER_UNAVAILABLE",
    });
  }
}

export function readStreamUploadKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): StreamUploadKeyring {
  const encodedKeyring = environment.CLOUDFLARE_STREAM_UPLOAD_KEYRING?.trim();
  const legacyEncodedKey =
    environment.CLOUDFLARE_STREAM_UPLOAD_ENCRYPTION_KEY?.trim();
  if (encodedKeyring && legacyEncodedKey) {
    throw new Error("Configure only CLOUDFLARE_STREAM_UPLOAD_KEYRING.");
  }
  if (!encodedKeyring) {
    const key = parseUploadEncryptionKey(
      legacyEncodedKey,
      "CLOUDFLARE_STREAM_UPLOAD_ENCRYPTION_KEY",
    );
    return { activeKeyId: "legacy", keys: new Map([["legacy", key]]) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKeyring);
  } catch {
    throw new Error("CLOUDFLARE_STREAM_UPLOAD_KEYRING must be JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CLOUDFLARE_STREAM_UPLOAD_KEYRING must be an object.");
  }
  const configuration = parsed as { activeKeyId?: unknown; keys?: unknown };
  if (
    typeof configuration.activeKeyId !== "string" ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(configuration.activeKeyId) ||
    !configuration.keys ||
    typeof configuration.keys !== "object" ||
    Array.isArray(configuration.keys)
  ) {
    throw new Error(
      "CLOUDFLARE_STREAM_UPLOAD_KEYRING requires an active key and keys object.",
    );
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(configuration.keys)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId) || typeof value !== "string") {
      throw new Error(
        "CLOUDFLARE_STREAM_UPLOAD_KEYRING contains an invalid key entry.",
      );
    }
    keys.set(keyId, parseUploadEncryptionKey(value, `key ${keyId}`));
  }
  if (!keys.has(configuration.activeKeyId)) {
    throw new Error(
      "The active Stream upload encryption key is missing from the keyring.",
    );
  }
  return { activeKeyId: configuration.activeKeyId, keys };
}

export function validateWebVtt(
  bytes: Buffer,
  maximumDurationSeconds?: number,
): void {
  const source = bytes.toString("utf8");
  if (
    bytes.byteLength === 0 ||
    source.includes("\u0000") ||
    Buffer.from(source, "utf8").compare(bytes) !== 0 ||
    !/^WEBVTT(?:\s|$)/.test(source)
  ) {
    throw new BadRequestException("Upload a valid WebVTT caption file.");
  }
  const cues = source.match(
    /^\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}\.\d{3}(?:\s+.*)?$/gm,
  );
  if (!cues || cues.length === 0 || cues.length > 10_000) {
    throw new BadRequestException("Upload a valid WebVTT caption file.");
  }
  for (const cue of cues) {
    const match =
      /((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/.exec(
        cue,
      );
    if (
      !match?.[1] ||
      !match[2] ||
      timestampMs(match[2]) <= timestampMs(match[1])
    ) {
      throw new BadRequestException(
        "Caption cue timestamps must be valid and increasing.",
      );
    }
    if (
      maximumDurationSeconds &&
      timestampMs(match[2]) > maximumDurationSeconds * 1000 + 500
    ) {
      throw new BadRequestException(
        "Caption cues cannot extend past the video duration.",
      );
    }
  }
}

function timestampMs(timestamp: string): number {
  const parts = timestamp.split(":");
  const last = parts.pop() ?? "";
  const [seconds = "0", milliseconds = "0"] = last.split(".");
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  return (
    ((hours * 60 + minutes) * 60 + Number(seconds)) * 1000 +
    Number(milliseconds)
  );
}

function parseUploadEncryptionKey(
  value: string | undefined,
  name: string,
): Buffer {
  if (!value) throw new Error("Missing stream upload encryption key.");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) {
    throw new Error(
      `${name} must be a canonical base64url encoding of 32 random bytes.`,
    );
  }
  return key;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function isValidUploadUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "upload.videodelivery.net"
    );
  } catch {
    return false;
  }
}

export function isValidStreamUid(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

async function readEnvelope<T>(
  response: Response,
): Promise<StreamApiEnvelope<T>> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_STREAM_API_RESPONSE_BYTES) {
    throw new ServiceUnavailableException(
      "The video provider returned an invalid response.",
    );
  }
  try {
    return JSON.parse(text) as StreamApiEnvelope<T>;
  } catch {
    throw new ServiceUnavailableException(
      "The video provider returned an invalid response.",
    );
  }
}

async function assertStreamSuccess(response: Response): Promise<void> {
  const envelope = await readEnvelope<unknown>(response);
  if (!response.ok || envelope.success !== true) {
    throw new ServiceUnavailableException({
      message: "The video provider could not complete the request.",
      errorCode: "CATALOG_VIDEO_PROVIDER_UNAVAILABLE",
    });
  }
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { CatalogMediaContentType } from "@aaraj/contracts";

// Bound R2 work for the current 10 MiB upload and 3 MiB rendition limits.
// These are operation safeguards, not product latency targets.
const R2_CONNECTION_TIMEOUT_MS = 5_000;
const R2_REQUEST_TIMEOUT_MS = 30_000;
const R2_RESPONSE_BODY_TIMEOUT_MS = 15_000;

interface R2Configuration {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

function readR2Configuration(environment: NodeJS.ProcessEnv): R2Configuration {
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} must be configured.`);
    return value;
  };

  const accountId = required("R2_ACCOUNT_ID");
  const bucketName = required("R2_BUCKET_NAME");
  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be a 32-character hexadecimal ID.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error("R2_BUCKET_NAME is not a valid bucket name.");
  }

  return {
    accountId,
    bucketName,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  };
}

@Injectable()
export class R2Storage implements OnApplicationShutdown, OnModuleInit {
  private storage:
    | {
        client: S3Client;
        bucketName: string;
      }
    | undefined;

  onModuleInit(): void {
    if (process.env.NODE_ENV === "production") this.getStorage();
  }

  private getStorage(): NonNullable<typeof this.storage> {
    if (this.storage) return this.storage;
    const configuration = readR2Configuration(process.env);
    this.storage = {
      bucketName: configuration.bucketName,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
        },
        requestHandler: {
          connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
          requestTimeout: R2_REQUEST_TIMEOUT_MS,
          throwOnRequestTimeout: true,
        },
      }),
    };
    return this.storage;
  }

  async putQuarantinedObject(input: {
    key: string;
    body: Buffer;
    contentType: CatalogMediaContentType;
    sha256: string;
  }): Promise<void> {
    const storage = this.getStorage();
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucketName,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.contentType,
        CacheControl: "private, no-store",
        Metadata: { "source-sha256": input.sha256 },
      }),
      requestOptions(),
    );
  }

  async putDerivativeObject(input: {
    key: string;
    body: Buffer;
    sha256: string;
  }): Promise<void> {
    const storage = this.getStorage();
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucketName,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: "image/webp",
        CacheControl: "private, no-store",
        Metadata: { "content-sha256": input.sha256 },
      }),
      requestOptions(),
    );
  }

  async deleteMediaObjects(keys: string[]): Promise<void> {
    const storage = this.getStorage();
    for (const key of keys) {
      await storage.client.send(
        new DeleteObjectCommand({ Bucket: storage.bucketName, Key: key }),
        requestOptions(),
      );
    }
  }

  async getPublishedDerivative(input: {
    key: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<Buffer> {
    const storage = this.getStorage();
    const response = await storage.client.send(
      new GetObjectCommand({ Bucket: storage.bucketName, Key: input.key }),
      requestOptions(),
    );
    if (!response.Body) throw new Error("R2 returned an empty media object.");
    const body = response.Body as AsyncIterable<Uint8Array> & {
      destroy?: (error?: Error) => void;
    };
    if (response.ContentLength !== input.sizeBytes) {
      body.destroy?.();
      throw new Error("R2 media object size does not match its manifest.");
    }

    if (typeof body.destroy !== "function") {
      throw new Error("R2 returned a non-streaming media object body.");
    }
    const bodyTimeout = setTimeout(() => {
      body.destroy?.(new Error("R2 media response body timed out."));
    }, R2_RESPONSE_BODY_TIMEOUT_MS);
    try {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes > input.sizeBytes) {
          throw new Error("R2 media object exceeded its manifest size.");
        }
        chunks.push(bytes);
      }
      if (totalBytes !== input.sizeBytes) {
        throw new Error("R2 media object is shorter than its manifest size.");
      }

      const result = Buffer.concat(chunks, totalBytes);
      if (createHash("sha256").update(result).digest("hex") !== input.sha256) {
        throw new Error("R2 media object does not match its manifest digest.");
      }
      return result;
    } finally {
      clearTimeout(bodyTimeout);
    }
  }

  onApplicationShutdown(): void {
    this.storage?.client.destroy();
  }
}

function requestOptions(): {
  abortSignal?: AbortSignal;
} {
  return { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) };
}

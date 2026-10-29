import { ServiceUnavailableException, Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../platform/database/database.service.js";
import { pathaoApiToken } from "./pathao-schema.js";
import { PathaoApiClient, PathaoRequestError } from "./pathao-api.client.js";
import {
  readPathaoConfiguration,
  type PathaoConfiguration,
} from "./pathao-config.js";
import type { OrderPiiKeyring } from "../../platform/crypto/order-pii-keyring.js";

const ACCESS_TOKEN_REUSE_SAFETY_MS = 30_000;
const REFRESH_LEASE_SECONDS = 30;
const REFRESH_WAIT_MS = 35_000;
const REFRESH_POLL_MS = 100;

type TokenDecision =
  | { kind: "ready"; accessToken: string }
  | { kind: "wait" }
  | { kind: "refresh"; owner: string; refreshToken: string | null };

@Injectable()
export class PathaoTokenService {
  constructor(
    private readonly database: DatabaseService,
    private readonly api: PathaoApiClient,
  ) {}

  async getAccessToken(): Promise<{
    config: PathaoConfiguration;
    accessToken: string;
  }> {
    const config = readPathaoConfiguration();
    if (!config) {
      throw new ServiceUnavailableException(
        "Pathao integration is not configured.",
        {
          errorCode: "PATHAO_NOT_CONFIGURED",
        },
      );
    }

    const waitUntil = Date.now() + REFRESH_WAIT_MS;
    while (Date.now() < waitUntil) {
      const decision = await this.claim(config);
      if (decision.kind === "ready") {
        return { config, accessToken: decision.accessToken };
      }
      if (decision.kind === "wait") {
        await delay(REFRESH_POLL_MS);
        continue;
      }

      try {
        let result: Awaited<ReturnType<PathaoApiClient["issueToken"]>>;
        if (!decision.refreshToken) {
          result = await this.api.issueToken(config, { type: "password" });
        } else {
          try {
            result = await this.api.issueToken(config, {
              type: "refresh_token",
              refreshToken: decision.refreshToken,
            });
          } catch (error) {
            // The supplied Pathao capture does not specify refresh-token
            // rotation or reuse semantics. If a refresh token is definitively
            // rejected, use the configured merchant credentials once while
            // holding the DB lease.
            // Network/5xx failures remain ambiguous and must not start another grant.
            if (
              !(error instanceof PathaoRequestError) ||
              (error.httpStatus !== 400 && error.httpStatus !== 401)
            ) {
              throw error;
            }
            result = await this.api.issueToken(config, { type: "password" });
          }
        }
        const encryptedAccess = encryptToken(
          result.accessToken,
          config.tokenEncryptionKeyring,
          config.mode,
          "access",
        );
        const encryptedRefresh = encryptToken(
          result.refreshToken,
          config.tokenEncryptionKeyring,
          config.mode,
          "refresh",
        );
        const saved = await this.database.db
          .update(pathaoApiToken)
          .set({
            accessTokenCiphertext: encryptedAccess,
            refreshTokenCiphertext: encryptedRefresh,
            accessExpiresAt: sql`clock_timestamp() + (${result.expiresInSeconds} * interval '1 second')`,
            refreshLeaseOwner: null,
            refreshLeaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(pathaoApiToken.environment, config.mode),
              eq(pathaoApiToken.refreshLeaseOwner, decision.owner),
            ),
          )
          .returning({ environment: pathaoApiToken.environment });
        if (saved.length !== 1) {
          throw new PathaoRequestError("PATHAO_TOKEN_REFRESH_LEASE_LOST");
        }
        return { config, accessToken: result.accessToken };
      } catch (error) {
        await this.releaseLease(config, decision.owner);
        if (error instanceof PathaoRequestError) {
          throw new ServiceUnavailableException(
            "Pathao authorization is unavailable.",
            { errorCode: error.code },
          );
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      "Pathao authorization refresh is already in progress.",
      { errorCode: "PATHAO_TOKEN_REFRESH_IN_PROGRESS" },
    );
  }

  private async claim(config: PathaoConfiguration): Promise<TokenDecision> {
    const owner = randomUUID();
    return this.database.db.transaction(async (transaction) => {
      await transaction
        .insert(pathaoApiToken)
        .values({ environment: config.mode })
        .onConflictDoNothing();

      const [row] = await transaction
        .select()
        .from(pathaoApiToken)
        .where(eq(pathaoApiToken.environment, config.mode))
        .for("update")
        .limit(1);
      if (!row) throw new Error("Pathao token row was not created.");

      const [timeState] = await transaction
        .select({
          accessIsFresh: sql<boolean>`coalesce(${pathaoApiToken.accessExpiresAt} > clock_timestamp() + (${ACCESS_TOKEN_REUSE_SAFETY_MS} * interval '1 millisecond'), false)`,
          refreshLeaseIsActive: sql<boolean>`coalesce(${pathaoApiToken.refreshLeaseExpiresAt} > clock_timestamp(), false)`,
        })
        .from(pathaoApiToken)
        .where(eq(pathaoApiToken.environment, config.mode))
        .limit(1);
      if (row.accessTokenCiphertext && timeState?.accessIsFresh) {
        try {
          return {
            kind: "ready",
            accessToken: decryptToken(
              row.accessTokenCiphertext,
              config.tokenEncryptionKeyring,
              config.mode,
              "access",
            ),
          };
        } catch {
          // A token encrypted with an earlier key is replaced using the
          // configured merchant credentials below.
        }
      }

      if (timeState?.refreshLeaseIsActive) {
        return { kind: "wait" };
      }

      const [leased] = await transaction
        .update(pathaoApiToken)
        .set({
          refreshLeaseOwner: owner,
          refreshLeaseExpiresAt: sql`clock_timestamp() + (${REFRESH_LEASE_SECONDS} * interval '1 second')`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(pathaoApiToken.environment, config.mode))
        .returning({ environment: pathaoApiToken.environment });
      if (!leased) throw new Error("Could not lease Pathao token refresh.");

      let refreshToken: string | null = null;
      if (row.refreshTokenCiphertext) {
        try {
          refreshToken = decryptToken(
            row.refreshTokenCiphertext,
            config.tokenEncryptionKeyring,
            config.mode,
            "refresh",
          );
        } catch {
          // If the prior encryption key is unavailable, issue a fresh token
          // with the merchant credentials instead of leaving booking blocked.
        }
      }
      return { kind: "refresh", owner, refreshToken };
    });
  }

  private async releaseLease(
    config: PathaoConfiguration,
    owner: string,
  ): Promise<void> {
    await this.database.db
      .update(pathaoApiToken)
      .set({
        refreshLeaseOwner: null,
        refreshLeaseExpiresAt: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(pathaoApiToken.environment, config.mode),
          eq(pathaoApiToken.refreshLeaseOwner, owner),
        ),
      );
  }
}

function encryptToken(
  value: string,
  keyring: OrderPiiKeyring,
  environment: string,
  purpose: "access" | "refresh",
): string {
  const keyId = keyring.activeKeyId;
  const key = keyring.keys.get(keyId);
  if (!key) throw new Error("The active Order PII encryption key is missing.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(`aaraj/pathao-token/v2:${keyId}:${environment}:${purpose}`),
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    keyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptToken(
  value: string,
  keyring: OrderPiiKeyring,
  environment: string,
  purpose: "access" | "refresh",
): string {
  try {
    const [version, ...fields] = value.split(".");
    const isV1 = version === "v1" && fields.length === 3;
    const isV2 =
      version === "v2" &&
      fields.length === 4 &&
      /^[A-Za-z0-9_-]+$/.test(fields[0] ?? "");
    if (!isV1 && !isV2) {
      throw new Error("invalid ciphertext");
    }
    const [keyId, nonceValue, ciphertextValue, tagValue] = isV1
      ? ["legacy", ...fields]
      : fields;
    if (!keyId || !nonceValue || !ciphertextValue || !tagValue) {
      throw new Error("ciphertext key or field is unavailable");
    }
    const key = keyring.keys.get(keyId);
    if (!key) throw new Error("ciphertext key is unavailable");
    const nonce = Buffer.from(nonceValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      Buffer.from(
        isV1
          ? `aaraj/pathao-token/v1:${environment}:${purpose}`
          : `aaraj/pathao-token/v2:${keyId}:${environment}:${purpose}`,
      ),
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ServiceUnavailableException(
      "Pathao's persisted authorization could not be read.",
      { errorCode: "PATHAO_TOKEN_STORAGE_UNAVAILABLE" },
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

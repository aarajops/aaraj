import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { redisStorage } from "@better-auth/redis-storage";
import { Logger } from "@nestjs/common";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { recordAuditEvent } from "../platform/audit/audit.service.js";
import { loadLocalEnvironment } from "../platform/config/local-environment.js";
import { getStorefrontOrigin } from "../platform/config/storefront-origin.js";
import { getDrizzleDatabase } from "../platform/database/database-client.js";
import { getRedisClient } from "../platform/redis/redis-client.js";
import { getCurrentRequestId } from "../platform/request-context.js";
import * as authSchema from "./auth-schema.js";
import { getClientIpOptions } from "./client-ip.js";

loadLocalEnvironment();

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 bytes.");
}

const configuredBaseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3001");
const baseURL = configuredBaseURL
  ? normalizeBetterAuthBaseURL(configuredBaseURL)
  : undefined;
const clientURL = getStorefrontOrigin();

if (!baseURL) {
  throw new Error("BETTER_AUTH_URL must be configured in production.");
}

const redis = getRedisClient();
const logger = new Logger("BetterAuth");

const authenticationEvents = new Map([
  ["/sign-up/email", "auth.email_sign_up"],
  ["/sign-in/email", "auth.email_sign_in"],
  ["/sign-out", "auth.sign_out"],
]);

export const auth = betterAuth({
  appName: "Aaraj",
  baseURL,
  basePath: "/api/auth",
  secret,
  trustedOrigins: [clientURL],
  advanced: {
    ipAddress: getClientIpOptions(),
  },
  database: drizzleAdapter(getDrizzleDatabase(), {
    provider: "pg",
    schema: authSchema,
    schemaName: "identity",
  }),
  secondaryStorage: redisStorage({
    client: redis,
    keyPrefix: process.env.BETTER_AUTH_REDIS_KEY_PREFIX ?? "better-auth:",
  }),
  session: {
    storeSessionInDatabase: true,
  },
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  hooks: {
    after: createAuthMiddleware(async (context) => {
      const event = authenticationEvents.get(context.path);
      if (!event) return;

      const failed = isAPIError(context.context.returned);
      const actorId =
        context.context.newSession?.user.id ?? context.context.session?.user.id;
      const requestId = getCurrentRequestId();
      const fields = {
        event,
        outcome: failed ? "failure" : "success",
        ...(actorId ? { userId: actorId } : {}),
        ...(requestId ? { requestId } : {}),
      };

      if (failed) {
        logger.warn("Authentication request failed", fields);
      } else {
        logger.log("Authentication request succeeded", fields);
      }

      try {
        await recordAuditEvent({
          actorType: actorId ? "user" : "anonymous",
          ...(actorId ? { actorId } : {}),
          eventType: event,
          subjectType: "auth_route",
          subjectId: context.path,
          metadata: { outcome: failed ? "failure" : "success" },
        });
      } catch (error) {
        logger.error("Authentication audit write failed", {
          event,
          error: error instanceof Error ? error.name : "unknown error",
        });
      }
    }),
  },
});

function normalizeBetterAuthBaseURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute HTTP(S) URL.");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (
    !["", "/api/auth"].includes(path) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an origin, optionally followed by /api/auth.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTP or HTTPS.");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }

  // The explicit Better Auth basePath owns the route. Strip the legacy path
  // form from BETTER_AUTH_URL so the mount path has one source of truth.
  return parsed.origin;
}

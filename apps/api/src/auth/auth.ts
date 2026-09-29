import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { redisStorage } from '@better-auth/redis-storage';
import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { loadLocalEnvironment } from '../platform/config/local-environment.js';
import { getDrizzleDatabase } from '../platform/database/database-client.js';
import { getRedisClient } from '../platform/redis/redis-client.js';
import * as authSchema from './auth-schema.js';

loadLocalEnvironment();

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
  throw new Error(
    'BETTER_AUTH_SECRET must contain at least 32 bytes of high-entropy secret data.',
  );
}

const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3001');
const clientURL =
  process.env.CLIENT_URL ??
  (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');

if (!baseURL || !clientURL) {
  throw new Error(
    'BETTER_AUTH_URL and CLIENT_URL must be configured in production.',
  );
}

const redis = getRedisClient();
const logger = new Logger('BetterAuth');

const authenticationEvents = new Map([
  ['/sign-up/email', 'auth.email_sign_up'],
  ['/sign-in/email', 'auth.email_sign_in'],
  ['/sign-out', 'auth.sign_out'],
]);

export const auth = betterAuth({
  appName: 'Aaraj',
  baseURL,
  basePath: '/api/auth',
  secret,
  trustedOrigins: [clientURL],
  database: drizzleAdapter(getDrizzleDatabase(), {
    provider: 'pg',
    schema: authSchema,
    schemaName: 'identity',
  }),
  secondaryStorage: redisStorage({
    client: redis,
    keyPrefix: process.env.BETTER_AUTH_REDIS_KEY_PREFIX ?? 'better-auth:',
  }),
  session: {
    storeSessionInDatabase: true,
  },
  rateLimit: {
    enabled: true,
    storage: 'secondary-storage',
    window: 60,
    max: 100,
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
      const userId = failed ? undefined : context.context.newSession?.user.id;
      const fields = {
        event,
        outcome: failed ? 'failure' : 'success',
        ...(userId ? { userId } : {}),
      };

      if (failed) {
        logger.warn('Authentication request failed', fields);
      } else {
        logger.log('Authentication request succeeded', fields);
      }
    }),
  },
});

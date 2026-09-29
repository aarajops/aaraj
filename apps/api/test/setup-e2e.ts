import { loadLocalEnvironment } from '../src/platform/config/local-environment.js';

process.env.NODE_ENV ??= 'test';
loadLocalEnvironment();
process.env.BETTER_AUTH_SECRET ??=
  'test-only-better-auth-secret-with-32-bytes-minimum';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001';
process.env.CLIENT_URL ??= 'http://localhost:3000';
process.env.POSTGRES_DB ??= 'aaraj_test';
process.env.POSTGRES_USER ??= 'aaraj_test';
process.env.POSTGRES_PASSWORD ??= 'aaraj_test';
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
redisUrl.pathname = '/15';
process.env.REDIS_URL = redisUrl.toString();
process.env.BETTER_AUTH_REDIS_KEY_PREFIX ??= `better-auth:test-${process.pid}:`;

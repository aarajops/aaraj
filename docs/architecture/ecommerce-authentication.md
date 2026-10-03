# Aaraj Authentication Plan

**Decision:** use Better Auth's email-and-password authentication through its documented NestJS integration. This file is the maintained auth decision and implementation reference for the [roadmap](ecommerce-implementation-roadmap.md).

## Launch scope

- Sign up and sign in with email and password only.
- Do not require email verification, OTP, or another verification step to create an account or sign in.
- Keep Better Auth's normal password hashing. Set a low-friction minimum of 8 characters and the documented maximum of 128; do not add character-composition rules.
- Use Better Auth's required `name`, `email`, and `password` sign-up fields. Name is profile data, not an authentication factor.

## NestJS integration

Keep the feature under `apps/api/src/auth/` using Nest's module structure. Create one Better Auth instance with the PostgreSQL Drizzle adapter and import the community-maintained `@thallesp/nestjs-better-auth` module. The adapter owns the `/api/auth/*` endpoints and global auth guard; do not create duplicate Nest auth controllers.

Follow the integration's Express setup: disable Nest's built-in body parser and configure the adapter's bounded JSON and URL-encoded parsers. Mark the existing root, health, and readiness routes anonymous with `@AllowAnonymous()`. Keep the API's exact CORS origin and Better Auth `trustedOrigins` aligned with `CLIENT_URL`.

Configure `BETTER_AUTH_SECRET` from a high-entropy environment secret, `BETTER_AUTH_URL` to the API origin, and `emailAndPassword.enabled: true` with `requireEmailVerification: false`, `minPasswordLength: 8`, and `maxPasswordLength: 128`.

## Web client

Use Better Auth's React client in `apps/web/src/features/auth/auth-client.ts`. The Next.js rewrite in `apps/web/next.config.ts` forwards browser requests from `/api/*` to NestJS, keeping auth requests and session cookies same-origin. The account route in `apps/web/src/app/account/page.tsx` forwards the incoming cookie to Better Auth's `get-session` endpoint through the session helper in `apps/web/src/features/auth/auth-session.ts`; the client calls `hydrateSession` as recommended for SSR. Because NestJS owns the Better Auth instance, Next.js calls its HTTP endpoint instead of importing the server instance or opening another database connection. The account UI in `apps/web/src/features/auth/auth-panel.tsx` provides email/password sign-up, sign-in, session display, and sign-out; it does not add phone, OTP, or email-verification steps.

## Rate limiting

Use Better Auth's built-in limiter, explicitly enabled in every environment. Keep its general limit at 100 requests per 60 seconds and retain its built-in stricter rules for sensitive routes; the official guide documents `/sign-in/email` at 3 requests per 10 seconds. Do not replace those rules with arbitrary custom limits. Store rate-limit counters through Better Auth's `secondary-storage` using the official `@better-auth/redis-storage` adapter and `ioredis`; do not add a parallel custom limiter. Since Better Auth uses secondary storage for sessions by default when configured, explicitly set `session.storeSessionInDatabase: true` to preserve the existing PostgreSQL session store. Redis is required for readiness and auth requests fail closed when its rate-limit storage operations fail. Show the `X-Retry-After` duration returned by Better Auth when the client receives `429`.

Better Auth uses the request IP for limiter keys. In production, `BETTER_AUTH_IP_ADDRESS_HEADER` or `BETTER_AUTH_TRUSTED_PROXIES` must be set, but not both. Use the header only when the ingress overwrites it and direct API access is blocked; otherwise list the exact proxy addresses/CIDRs. Do not trust arbitrary `X-Forwarded-For` values. The actual ingress is a deployment decision and must be supplied before production startup.

## PostgreSQL and migrations

Use the Better Auth Drizzle adapter with the existing PostgreSQL/Drizzle connection and keep auth-owned tables in the `identity` PostgreSQL schema. Runtime PostgreSQL connections explicitly require certificate verification in production; `POSTGRES_SSL_CA_FILE` supplies a provider CA bundle when it is absent from the system trust store. Local Compose remains plaintext. The schema is in `apps/api/src/auth/auth-schema.ts`; Drizzle Kit is configured in `apps/api/drizzle.config.ts`. Generate and review the migration with Drizzle Kit. Do not use Better Auth's direct database migration command with the Drizzle adapter, and do not apply the complete proposed e-commerce schema as a single migration.

Better Auth owns its core `user`, `session`, `account`, and `verification` tables. Keep commerce identity extensions and authorization tables out of the first auth migration unless an implemented feature requires them. Email verification remains disabled as a sign-up/sign-in gate; the verification table is part of Better Auth's core schema and can support its other token workflows.

## Implementation and checks

The Better Auth configuration, Nest module, local environment settings, PostgreSQL schema/migrations, and web account screen are implemented. Auth outcomes are written to the audit table without storing submitted credentials or email addresses. The API E2E suite exercises real PostgreSQL and Redis, email/password sessions, HTTP sign-in/sign-out, rate limits, audit writes, catalog access, and protected PBAC routes. Tests create disposable databases and isolated Redis keys; see [the authorization guide](../backend/security/02-authorization.md) for the role matrix, bootstrap command, and security cases. Customer access is the default, and role grants are resolved independently of Better Auth's session payload. Privileged role changes require a recent password sign-in without adding OTP or email-verification gates to customer registration. Before production, also verify the trusted proxy list and network boundary, that only the configured frontend origin is trusted, parser limits apply, and credentials/secrets never appear in logs.

References: [Better Auth installation](https://better-auth.com/docs/installation), [email and password](https://better-auth.com/docs/authentication/email-password), [client](https://better-auth.com/docs/concepts/client), [server API](https://better-auth.com/docs/concepts/api), [users and accounts](https://better-auth.com/docs/concepts/users-accounts), [rate limiting](https://better-auth.com/docs/concepts/rate-limit), [session management](https://better-auth.com/docs/concepts/session-management), [cookies](https://better-auth.com/docs/concepts/cookies), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [NestJS integration](https://better-auth.com/docs/integrations/nestjs), and [NestJS modules](https://docs.nestjs.com/modules).

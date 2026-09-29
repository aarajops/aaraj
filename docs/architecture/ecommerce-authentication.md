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

Use Better Auth's React client in `apps/web/lib/auth-client.ts`. The Next.js rewrite in `apps/web/next.config.ts` forwards browser requests from `/api/*` to NestJS, keeping auth requests and session cookies same-origin. The server page forwards the incoming cookie to Better Auth's `get-session` endpoint, then the client calls `hydrateSession` as recommended for SSR. This keeps the Better Auth instance and database access in NestJS. The account screen in `apps/web/app/auth-panel.tsx` provides email/password sign-up, sign-in, session display, and sign-out; it does not add phone, OTP, or email-verification steps.

## PostgreSQL and migrations

Use the Better Auth Drizzle adapter with the existing PostgreSQL/Drizzle connection and keep auth-owned tables in the `identity` PostgreSQL schema. The schema is in `apps/api/src/auth/auth-schema.ts`; Drizzle Kit is configured in `apps/api/drizzle.config.ts`. Generate and review the migration with Drizzle Kit. Do not use Better Auth's direct database migration command with the Drizzle adapter, and do not apply the complete proposed e-commerce schema as a single migration.

Better Auth owns its core `user`, `session`, `account`, and `verification` tables. Keep commerce identity extensions and authorization tables out of the first auth migration unless an implemented feature requires them. Email verification remains disabled as a sign-up/sign-in gate; the verification table is part of Better Auth's core schema and can support its other token workflows.

## Implementation and checks

The Better Auth configuration, Nest module, local environment settings, PostgreSQL schema/migration, and web account screen are implemented. Local checks confirmed database readiness, email/password sign-up and sign-in without an email-verification gate, session lookup, sign-out revocation, and the same auth flow through the Next.js `/api` rewrite. The web app passes typecheck, lint, and production build. Before production, also verify that only the configured frontend origin is trusted, health routes remain public, protected routes require a session, parser limits apply, and credentials/secrets never appear in logs.

References: [Better Auth installation](https://better-auth.com/docs/installation), [email and password](https://better-auth.com/docs/authentication/email-password), [cookies](https://better-auth.com/docs/concepts/cookies), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [NestJS integration](https://better-auth.com/docs/integrations/nestjs), and [NestJS modules](https://docs.nestjs.com/modules).

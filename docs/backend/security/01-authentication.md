# 01 - Authentication

Aaraj uses Better Auth email/password authentication through its documented NestJS integration. The maintained configuration and local setup are in [the authentication plan](../../architecture/ecommerce-authentication.md).

`apps/api/src/auth/auth.ts` owns the Better Auth instance, Drizzle adapter, Redis secondary storage, session settings, and built-in authentication rate limiting. `auth.module.ts` imports the community-maintained `@thallesp/nestjs-better-auth` adapter described by Better Auth's NestJS integration guide. `main.ts` disables Nest's built-in body parser; the adapter configures bounded parsing and mounts `/api/auth/*`.

NestJS's official authentication page also documents a separate `@nestjs/authentication` package. That package provides its own authentication services, provider model, storage interfaces, and routes. It is an alternative architecture, not a required layer for Better Auth. AARAJ deliberately uses Better Auth as its sole authentication authority; do not install both systems or duplicate their session and sign-in flows.

The server, Drizzle adapter, Redis storage adapter, and web client are pinned to Better Auth `1.7.14`. Keep these Better Auth packages on the same exact release when updating; Better Auth publishes security fixes that require coordinated package versions.

The adapter registers its authentication guard globally. Use `@AllowAnonymous()` only for deliberately public routes, `@OptionalAuth()` when a public route may use an existing session, and `@Session()` to access the authenticated session. Aaraj does not add a separate password-hashing service, JWT issuer, or custom authentication guard.

Customer registration uses name, email, and password. Email verification and OTP are not required. The first account is a customer; it gains no staff privileges automatically.

Application permissions are owned by [the authorization base](02-authorization.md). Authentication establishes identity; a valid session alone does not authorize a privileged business action. Cookie-authenticated business writes also require a trusted Origin, and sensitive auth endpoints retain Better Auth's built-in safeguards.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [NestJS integration](https://better-auth.com/docs/integrations/nestjs), [adapter repository](https://github.com/ThallesP/nestjs-better-auth), [stored NestJS authentication source](official-references/nestjs-authentication.md).

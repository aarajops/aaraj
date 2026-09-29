# 01 - Authentication

Aaraj uses Better Auth email/password authentication through its documented NestJS integration. The maintained configuration and local setup are in [the authentication plan](../../architecture/ecommerce-authentication.md).

`apps/api/src/auth/auth.ts` owns the Better Auth instance, Drizzle adapter, Redis secondary storage, session settings, and built-in authentication rate limiting. `auth.module.ts` imports the community-maintained `@thallesp/nestjs-better-auth` adapter. `main.ts` disables Nest's built-in body parser; the adapter configures bounded parsing and mounts `/api/auth/*`.

The adapter registers its authentication guard globally. Use `@AllowAnonymous()` only for deliberately public routes, `@OptionalAuth()` when a public route may use an existing session, and `@Session()` to access the authenticated session. Aaraj does not add a separate password-hashing service, JWT issuer, or custom authentication guard.

Customer registration uses name, email, and password. Email verification and OTP are not required. The first account is a customer; it gains no staff privileges automatically.

Application permissions are owned by [the authorization base](02-authorization.md). Authentication establishes identity; a valid session alone does not authorize a privileged business action. Role mutation endpoints additionally require a recent sign-in and trusted Origin, as described in that guide.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [NestJS integration](https://better-auth.com/docs/integrations/nestjs), [adapter repository](https://github.com/ThallesP/nestjs-better-auth).

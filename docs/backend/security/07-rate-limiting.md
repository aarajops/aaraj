# 07 - Rate Limiting & Throttling

AARAJ has two separate rate limiters. Better Auth owns authentication endpoints; NestJS Throttler guards Nest controller routes. The Better Auth adapter mounts `/api/auth/*` as middleware, so those requests use Better Auth's limiter rather than being counted again by the Nest controller guard.

## Better Auth endpoints

`apps/api/src/auth/auth.ts` explicitly enables Better Auth rate limiting and stores counters in Redis through `@better-auth/redis-storage`. AARAJ leaves Better Auth's built-in IP-based limits in place: 100 requests per 10 seconds generally and 3 requests per 10 seconds for `/sign-in/email`. It defines no custom sign-in or sign-up windows. The auth panel displays Better Auth's `X-Retry-After` value on HTTP `429` responses.

The NestJS authentication guide's email-and-IP and account-only throttler examples apply to routes built with its own `@nestjs/authentication` package. They are not Better Auth configuration. Better Auth's documented `customRules` set path-specific windows and limits; they do not expose the Nest throttler's `getTracker` callback for an account key. AARAJ therefore has no per-account login lockout: its documented credential-login protection is the Better Auth per-IP rule. If account-level throttling is required, choose a Better Auth-compatible extension and approve the lockout behavior and thresholds explicitly; do not imply that the current IP limiter provides it.

Keep `better-auth`, `@better-auth/drizzle-adapter`, and `@better-auth/redis-storage` on the same exact release. Better Auth's NestJS adapter is community maintained and should be upgraded within its declared compatibility range.

## Commerce API endpoints

`apps/api/src/app.module.ts` configures `@nestjs/throttler` with a limit of 120 requests in a one-minute TTL and uses `RedisThrottlerStorage` for shared counters. Nest's default generated key includes the controller, handler, throttler name, and client tracker; this is 120 requests per minute per client tracker per controller handler, not one combined budget across the entire API. The value is AARAJ's configured policy, not a NestJS-prescribed threshold. `ApiThrottlerGuard` hashes normalized client addresses before using them in Redis keys and returns `Retry-After` when a request is limited.

## Trusted client addresses

Production must configure exactly one of `BETTER_AUTH_IP_ADDRESS_HEADER` or `BETTER_AUTH_TRUSTED_PROXIES`:

- Use a header only when ingress overwrites it with the actual client address and the API cannot be reached directly.
- Otherwise list the exact proxy IP addresses or CIDRs. Do not trust a broad network or client-supplied `X-Forwarded-For` values.

The selected proxy configuration is validated when the API starts. With `BETTER_AUTH_TRUSTED_PROXIES`, Express and Better Auth use the configured proxy list. With `BETTER_AUTH_IP_ADDRESS_HEADER`, both rate-limit trackers read that header and Express does not trust the forwarded chain. The production Nginx template overwrites `X-Real-IP` and `X-Forwarded-For`; the API binds to loopback on the production host.

References: [NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting), [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit), [Better Auth security](https://better-auth.com/docs/reference/security), [stored NestJS rate-limiting source](official-references/nestjs-rate-limiting.md).

# 04 - Security Headers (Helmet)

> **Source Reference**: [NestJS Official Documentation - Security Headers](https://docs.nestjs.com/security/helmet)

Security headers instruct client browsers to enforce protections against common web attacks such as Cross-Site Scripting (XSS), Clickjacking, MIME-type sniffing, and SSL stripping.

Starting with **NestJS v12.1**, Nest includes native security header support via `app.useSecurityHeaders()`. It matches the defaults of **Helmet 8**, works identically across both Express and Fastify adapters, and requires zero external third-party dependencies.

---

## 1. Enabling Security Headers

Call `useSecurityHeaders()` immediately after creating the application instance in `main.ts`:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enforce Helmet 8 security headers across all responses:
  app.useSecurityHeaders();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

### Execution Rules:
- Must be called **before** `app.init()` or `app.listen()`. Calling it afterward or twice throws an error.
- Applies to all HTTP routes, 404 responses, exceptions, CSRF rejections, and Server-Sent Events (SSE).
- The `X-Powered-By` header is permanently removed to prevent server fingerprinting.

---

## 2. Default Headers Sent

By default, `app.useSecurityHeaders()` outputs the following headers:

| Header | Default Value | Security Purpose |
| :--- | :--- | :--- |
| `Strict-Transport-Security` (HSTS) | `max-age=31536000; includeSubDomains` | Forces HTTPS connections for 1 year. |
| `X-Content-Type-Options` | `nosniff` | Prevents browser MIME-type sniffing. |
| `X-Frame-Options` | `SAMEORIGIN` | Blocks framing by external sites to prevent Clickjacking. |
| `Referrer-Policy` | `no-referrer` | Prevents leaking referral paths in HTTP request headers. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates browsing context from cross-origin popups. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevents other sites from loading your media assets. |
| `Origin-Agent-Cluster` | `?1` | Requests origin-keyed process isolation in modern browsers. |
| `X-XSS-Protection` | `0` | Disables legacy buggy XSS filters that introduced vulnerabilities. |
| `X-Download-Options` | `noopen` | Prevents old Internet Explorer from executing downloads directly. |
| `X-Permitted-Cross-Domain-Policies` | `none` | Prevents Adobe Flash/Acrobat cross-domain policy access. |
| `X-Powered-By` | *Removed* | Eliminates framework version information from attackers. |
| `Content-Security-Policy` | Restrictive whitelist | Mitigates XSS by controlling executable script origins. |

---

## 3. Configuring Custom Headers

You can disable specific headers by passing `false`, or customize directives using configuration objects:

```typescript
// apps/api/src/main.ts
app.useSecurityHeaders({
  xFrameOptions: false, // Disables X-Frame-Options if embedding in legitimate iframes
  strictTransportSecurity: {
    maxAge: 63072000,   // 2 years in seconds
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
});
```

---

## 4. Content Security Policy (CSP) Directives

CSP prevents script injection attacks by declaring approved sources of executable code.

```typescript
app.useSecurityHeaders({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://cdn.aaraj.io'],
      connectSrc: ["'self'", 'wss://realtime.aaraj.io'],
      imgSrc: ["'self'", 'data:', 'https://images.aaraj.io'],
      upgradeInsecureRequests: null, // Remove directive if testing over HTTP locally
    },
  },
});
```

> **Production Warning (`'unsafe-inline'`)**: Avoid adding `'unsafe-inline'` to `scriptSrc` in production. It defeats the primary protection that CSP offers against Cross-Site Scripting.

---

## 5. Accommodating Swagger UI & GraphQL IDEs

API documentation tools (Swagger UI, GraphQL Playground) require inline styles and script assets:

```typescript
const isProduction = process.env.NODE_ENV === 'production';

app.useSecurityHeaders({
  contentSecurityPolicy: isProduction
    ? true // Enforce strict default CSP in production
    : {
        directives: {
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
});
```

---

## 6. Standalone Helmet Reference (Legacy / Custom Middleware)

If integrating standalone Helmet manually on Express or Fastify:

### Express:
```bash
pnpm --filter @aaraj/api add helmet
```
```typescript
import helmet from 'helmet';
app.use(helmet());
```

### Fastify:
```bash
pnpm --filter @aaraj/api add @fastify/helmet
```
```typescript
import helmet from '@fastify/helmet';
await app.register(helmet);
```

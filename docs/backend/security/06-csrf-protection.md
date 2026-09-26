# 06 - CSRF Protection

> **Source Reference**: [NestJS Official Documentation - CSRF Protection](https://docs.nestjs.com/security/csrf)

Cross-Site Request Forgery (CSRF/XSRF) is an attack where a malicious website tricks a victim's browser into executing unwanted state-changing actions (e.g. money transfers, password updates) against an authenticated web application. Because browsers automatically attach cookies and ambient credentials to cross-origin requests, the server cannot distinguish between legitimate and forged requests.

Starting with **NestJS v12.1**, Nest includes **built-in zero-configuration CSRF protection**. It requires no cookies, sessions, or custom frontend headers, and operates identically across both Express and Fastify.

---

## 1. How Modern CSRF Protection Works

Nest's built-in protection is based on the modern browser [Fetch Metadata](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-Fetch-Site) standard and follows the Go 1.25 `CrossOriginProtection` specification:

1. **Idempotent Requests Allowed**: Safe HTTP methods (`GET`, `HEAD`, `OPTIONS`) are always allowed without restriction.
2. **Fetch Metadata Inspection**: If the browser sends a `Sec-Fetch-Site` header:
   - `same-origin` (request initiated from your own site) is **allowed**.
   - `none` (direct user action, e.g. typing URL or opening bookmark) is **allowed**.
   - `cross-site` or `same-site` (initiated by a foreign site or sibling subdomain) is **rejected**.
3. **Non-Browser Client Exemption**: Requests lacking both `Sec-Fetch-Site` and `Origin` headers (cURL, server-to-server microservices, mobile apps) are **allowed** automatically.
4. **Origin Fallback**: If `Sec-Fetch-Site` is missing but `Origin` is present, the host portion of `Origin` must match the request's `Host` (or `:authority` on HTTP/2) header.

---

## 2. Enabling Built-in CSRF Protection

Call `app.enableCsrfProtection()` immediately after creating the app instance in `main.ts`:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCsrfProtection({
    // Explicit list of trusted frontends that may perform cross-origin mutations:
    trustedOrigins: ['https://admin.araz.io', 'http://localhost:3000'],

    // Explicitly exclude external webhook callbacks:
    exclude: [
      { path: 'webhooks/stripe', method: RequestMethod.POST },
      { path: 'auth/saml/callback', method: RequestMethod.POST },
    ],
  });

  await app.listen(3000);
}
bootstrap();
```

---

## 3. Trusted Origins & Webhook Exclusions

### Trusted Origins
Frontend applications hosted on sibling subdomains (e.g. `https://admin.araz.io` communicating with `https://api.araz.io`) are treated by browsers as cross-origin. List them in `trustedOrigins`:

- Format must be exact: `scheme://host[:port]` (no trailing slashes, paths, or query params).
- Normalizes comparisons automatically against incoming `Origin` headers.

### Excluding Routes (Webhooks & SAML)
Third-party services (e.g. Stripe, GitHub Webhooks, Auth0 SAML form posts) deliver cross-origin `POST` requests without `Sec-Fetch-Site: same-origin`. These routes must be explicitly registered in `exclude`:

```typescript
exclude: [
  { path: 'webhooks/:provider', method: RequestMethod.POST },
  { path: 'auth/callback', method: RequestMethod.POST },
]
```

---

## 4. Rejection Behavior

A rejected CSRF request throws a `ForbiddenException` (HTTP 403) before route handlers, pipes, or controllers execute:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Cross-origin request detected from Sec-Fetch-Site header"
}
```

---

## 5. Token-Based CSRF Fallback (Legacy Browsers)

If your application must support legacy browsers that do not send Fetch Metadata:

### Express Setup with `csrf-csrf`:
```bash
pnpm --filter @araz/api add csrf-csrf cookie-parser
```

```typescript
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';

app.use(cookieParser('cookie-secret'));
const { doubleCsrfProtection } = doubleCsrf({
  getSecret: () => 'super-secret-key',
  cookieName: 'x-csrf-token',
});
app.use(doubleCsrfProtection);
```

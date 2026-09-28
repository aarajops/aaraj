# 05 - Cross-Origin Resource Sharing (CORS)

> **Source Reference**: [NestJS Official Documentation - CORS](https://docs.nestjs.com/security/cors)

Cross-Origin Resource Sharing (CORS) is a browser security mechanism that restricts web applications running on one domain (e.g. `https://app.aaraj.io`) from requesting resources on a different domain (e.g. `https://api.aaraj.io`).

NestJS integrates with the underlying HTTP adapter's CORS implementation—using Express [cors](https://github.com/expressjs/cors) or Fastify [@fastify/cors](https://github.com/fastify/fastify-cors).

---

## 1. Enabling CORS in `main.ts`

Call `enableCors()` on the application instance before listening:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['https://aaraj.io', 'https://admin.aaraj.io'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
    credentials: true, // Allow cookies and authorization headers
    maxAge: 86400,     // Cache preflight OPTIONS responses for 24 hours
  });

  await app.listen(3000);
}
bootstrap();
```

---

## 2. Express vs. Fastify Default Methods Disparity

> **Critical Warning**: The underlying Express and Fastify packages do **not** share identical default allowed methods:
> - **Express `cors`**: Allows `GET, HEAD, PUT, PATCH, POST, DELETE` by default.
> - **Fastify `@fastify/cors`**: Allows only the CORS-safelisted methods: `GET, HEAD, POST`.
>
> If your application runs on Fastify, cross-origin `PUT`, `PATCH`, or `DELETE` requests will be rejected during the preflight `OPTIONS` check unless you explicitly specify `methods`.

### Best Practice
**Always declare `methods` explicitly** across all environments:

```typescript
app.enableCors({
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
});
```

---

## 3. Dynamic Origin Whitelisting

When allowed origins depend on runtime environment variables or database tenants, pass a dynamic evaluation callback:

```typescript
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'];

app.enableCors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server, mobile apps) where origin is undefined
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
});
```

---

## 4. Production Security Checklist

| Vulnerability | Mitigation |
| :--- | :--- |
| **Wildcard with Credentials** | Browsers reject `Access-Control-Allow-Origin: *` when `credentials: true`. Always specify explicit origins. |
| **Over-permissive Origin Matching** | Avoid using loose regexes like `/aaraj\.io/` which unintentionally match malicious domains like `attacker-aaraj.io`. Use exact string arrays. |
| **Preflight Overhead** | Set `maxAge: 86400` so browsers cache preflight `OPTIONS` checks, eliminating duplicate HTTP handshakes. |

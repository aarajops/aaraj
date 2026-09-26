# 08 - Performance (Fastify)

> **Source Reference**: [NestJS Official Documentation - Performance (Fastify)](https://docs.nestjs.com/http/performance)

NestJS is HTTP framework-independent. While **Express** is the default HTTP engine due to its massive ecosystem and widespread familiarity, **Fastify** is an enterprise-grade alternative engineered specifically for maximum performance and minimal overhead, achieving up to **2x to 3x higher throughput** (up to ~75,000 requests/sec compared to Express's ~25,000 requests/sec in synthetic benchmarks).

---

## 1. Installation & Bootstrapping

To use Fastify as the HTTP provider, install `@nestjs/platform-fastify`:

```bash
pnpm --filter @araz/api add @nestjs/platform-fastify
```

### Application Bootstrap (`NestFastifyApplication`)

Pass an instance of `FastifyAdapter` to `NestFactory.create()` and type the application as `NestFastifyApplication`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env.NODE_ENV !== 'production',
      bodyLimit: 10 * 1024 * 1024, // 10 MB payload limit
    }),
  );

  // CRITICAL: Fastify defaults to binding only to '127.0.0.1' (localhost).
  // In Docker containers and Kubernetes pods, listen on '0.0.0.0' to accept external ingress.
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
```

> [!CAUTION]
> **Container Networking Requirement**:
> Fastify strictly binds to `127.0.0.1` by default. If running in a Docker container or Kubernetes pod without `'0.0.0.0'` passed to `app.listen()`, health checks and external traffic will fail with connection refused.

---

## 2. Key Differences from Express

### Redirects

In Express, `res.redirect('/target')` is standard. In Fastify, you must explicitly set the HTTP status code before issuing the redirect:

```typescript
// Fastify redirect pattern
@Get('legacy-login')
legacyLogin(@Res() res: FastifyReply) {
  res.status(302).redirect('/v2/login');
}
```

### Raw Middleware Parameters

Middleware registered via `MiddlewareConsumer` runs on `@fastify/middie` under the hood. Middleware functions receive the **raw Node.js `IncomingMessage` and `ServerResponse`** instances rather than Fastify's encapsulated wrappers:

```typescript
// src/common/middleware/fastify-logger.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class FastifyLoggerMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
    console.log(`[Raw Request] ${req.method} ${req.url}`);
    next();
  }
}
```

---

## 3. Fastify-Specific Decorators

NestJS provides decorators to hook directly into Fastify's routing engine:

### Route Configuration (`@RouteConfig`)

Attach custom metadata to Fastify routes, accessible in pre-validation hooks or custom guards:

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

@Controller('feature')
export class FeatureController {
  @RouteConfig({ rateLimitTier: 'high', auditLevel: 3 })
  @Get()
  getFeature(@Req() req: FastifyRequest) {
    return req.routeConfig;
  }
}
```

### Route Constraints (`@RouteConstraints`)

Fastify supports route constraints (such as versioning or host header constraints) at the engine level:

```typescript
import { Controller, Get } from '@nestjs/common';
import { RouteConstraints } from '@nestjs/platform-fastify';

@Controller('service')
export class ServiceController {
  @RouteConstraints({ version: '2.0.0' })
  @Get('info')
  getV2Info() {
    return { version: '2.0.0', engine: 'fastify' };
  }
}
```

---

## 4. Testing Fastify Applications (`app.inject()`)

Fastify provides the high-performance `.inject()` utility for end-to-end (E2E) testing, allowing tests to simulate HTTP requests without binding to an actual TCP network port:

```typescript
// test/fastify-app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';

describe('Fastify E2E Testing', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    await app.init();
    // Ensure the Fastify underlying server instance is fully initialized
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 OK', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toEqual(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });
});
```

---

## 5. Express to Fastify Migration Checklist

When transitioning from Express to Fastify in `@araz/api`:

1. **CORS Default Methods**: Express defaults to `GET, HEAD, PUT, PATCH, POST, DELETE`. Fastify defaults strictly to safelisted CORS methods (`GET, HEAD, POST`). Explicitly configure `methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']` when enabling CORS in Fastify.
2. **Library-Specific Decorators**: Remove any imports of `Request` and `Response` from `express`. Replace them with `FastifyRequest` and `FastifyReply` from `fastify`, or preferably eliminate `@Res()` in favor of standard return types.
3. **Multipart Uploads**: Replace `@nestjs/platform-express` interceptors with `@nestjs/platform-fastify/multipart`.
4. **Security Headers**: Fastify works out of the box with `app.useSecurityHeaders()`.
5. **Cookie Parsing**: Utilize NestJS 12.1+ built-in cookie support (`@Cookies()`, `@SignedCookies()`) which works seamlessly on Fastify without `@fastify/cookie`.

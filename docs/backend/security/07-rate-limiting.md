# 07 - Rate Limiting & Throttling

> **Source Reference**: [NestJS Official Documentation - Rate Limiting](https://docs.nestjs.com/security/rate-limiting)

Rate limiting restricts the number of incoming requests a client (identified by IP address, API key, or authentication token) can execute within a specific time window. It prevents brute-force credential stuffing, API scraping, and Denial of Service (DoS) attacks.

NestJS provides the `@nestjs/throttler` package for declarative, multi-tier rate limiting.

---

## 1. Installation & Module Setup

```bash
pnpm --filter @aaraj/api add @nestjs/throttler
```

### Module Registration in `AppModule`

Configure multi-tier sliding windows (short bursts vs sustained limits) in `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: seconds(1), // 1 second
        limit: 3,        // Max 3 requests per second
      },
      {
        name: 'medium',
        ttl: seconds(10), // 10 seconds
        limit: 20,        // Max 20 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: seconds(60), // 1 minute
        limit: 100,       // Max 100 requests per minute
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // Protect all routes automatically!
    },
  ],
})
export class AppModule {}
```

---

## 2. Route-Level Customization (`@Throttle` & `@SkipThrottle`)

### Overriding Limits on Sensitive Endpoints (`@Throttle`)

Authentication and password reset endpoints require much tighter rate limits:

```typescript
// src/auth/auth.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  // Allow max 5 login attempts per minute
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  login(@Body() loginDto: unknown) {
    return { status: 'OK' };
  }
}
```

### Bypassing Throttling on Public/Health Routes (`@SkipThrottle`)

```typescript
// src/app.controller.ts
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle() // Disables rate limiting for health check ping probes
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'healthy' };
  }
}
```

---

## 3. Reverse Proxies & Accurate IP Extraction

When deploying behind reverse proxies, load balancers, or Cloudflare, all incoming TCP connections originate from the proxy's IP address. Without proper configuration, all clients share a single rate-limiting bucket!

### Step 1: Enable `trust proxy` in `main.ts`

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust proxy hops (e.g. Nginx, Cloudflare, AWS ALB)
  app.set('trust proxy', 1);

  await app.listen(3000);
}
bootstrap();
```

### Step 2: Custom Tracker Guard for Proxy Header (`X-Forwarded-For`)

Subclass `ThrottlerGuard` to extract the true client IP from `req.ips`:

```typescript
// src/common/guards/proxy-throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    // req.ips contains the array of client IP addresses populated by 'trust proxy'
    const clientIp = req.ips?.length ? req.ips[0] : req.ip;
    return clientIp ?? 'unknown';
  }
}
```

Use `ProxyThrottlerGuard` as your `APP_GUARD`.

---

## 4. Distributed Redis Storage (`@nest-lab/throttler-storage-redis`)

In Kubernetes multi-replica deployments, each container replica maintains its own in-memory storage. A client can bypass limits by round-robining requests across pods.

Use Redis as the centralized distributed throttler store:

```bash
pnpm --filter @aaraj/api add @nest-lab/throttler-storage-redis ioredis
```

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: seconds(60), limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'),
        ),
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 5. Rate Limit Response Headers

When a request is processed, the throttler automatically injects telemetry headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 94
X-RateLimit-Reset: 1790436000
```

When the limit is breached, the API immediately responds with `429 Too Many Requests`:
```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

# 03 - Session

> **Source Reference**: [NestJS Official Documentation - Session](https://docs.nestjs.com/http/session)

HTTP sessions provide server-side state persistence across multiple requests from the same user. While modern stateless REST APIs primarily utilize signed JWTs, stateful sessions are common in Server-Side Rendered (SSR) applications, internal admin consoles, and complex workflows requiring instant server-side revocation.

NestJS supports session management across both **Express** (`express-session`) and **Fastify** (`@fastify/secure-session`).

---

## 1. Express Implementation (`express-session`)

### Installation

```bash
pnpm --filter @araz/api add express-session
pnpm --filter @araz/api add -D @types/express-session
```

### Application Configuration

Register `express-session` as global middleware in `main.ts`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'strong-cryptographic-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24, // 1 day in milliseconds
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

> [!WARNING]
> **Production Warning on `MemoryStore`**:
> The default session store (`MemoryStore`) included with `express-session` stores sessions in Node.js process memory. It leaks memory under continuous load, cannot survive process restarts, and cannot share session state across multi-instance or Kubernetes deployments. **A persistent distributed store (e.g. Redis) is mandatory for production**.

---

## 2. Production Distributed Session Storage (Redis)

In containerized or horizontally scaled deployments, use `connect-redis` backed by `ioredis`:

```bash
pnpm --filter @araz/api add connect-redis ioredis
pnpm --filter @araz/api add -D @types/ioredis
```

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Initialize Redis client
  const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'sess:araz:',
  });

  // When behind Nginx / Cloudflare / AWS ALB
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  app.use(
    session({
      store: redisStore,
      secret: [process.env.SESSION_SECRET_CURRENT!, process.env.SESSION_SECRET_OLD!],
      resave: false,
      saveUninitialized: false,
      name: 'araz.sid',
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days in ms
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

---

## 3. Reading and Writing Sessions

NestJS provides the `@Session()` parameter decorator to directly extract the session object in controllers.

```typescript
// src/auth/session.controller.ts
import { Controller, Get, Post, Session, UnauthorizedException } from '@nestjs/common';

interface UserSession {
  userId?: string;
  role?: string;
  views?: number;
}

@Controller('session')
export class SessionController {
  @Get('profile')
  getProfile(@Session() session: UserSession) {
    if (!session.userId) {
      throw new UnauthorizedException('No active session found');
    }
    session.views = (session.views ?? 0) + 1;
    return {
      userId: session.userId,
      role: session.role,
      pageViews: session.views,
    };
  }

  @Post('login')
  login(@Session() session: UserSession) {
    session.userId = 'usr_9981';
    session.role = 'ADMIN';
    session.views = 0;
    return { message: 'Logged in successfully' };
  }

  @Post('logout')
  logout(@Session() session: Record<string, any>) {
    return new Promise((resolve, reject) => {
      session.destroy((err: unknown) => {
        if (err) return reject(err);
        resolve({ message: 'Logged out successfully' });
      });
    });
  }
}
```

---

## 4. Fastify Implementation (`@fastify/secure-session`)

Fastify does not use `express-session`; instead, it provides `@fastify/secure-session`, which encrypts the entire session payload into an authenticated client-side cookie or server store using Sodium cryptography.

### Installation

```bash
pnpm --filter @araz/api add @fastify/secure-session
```

### Configuration in Fastify Bootstrap

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import secureSession from '@fastify/secure-session';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(secureSession, {
    // Secret must be a minimum of 32 characters
    secret: process.env.SECURE_SESSION_SECRET || 'averylongsecretpassphrasegreaterthan32chars',
    salt: process.env.SECURE_SESSION_SALT || 'mq9hDxBVDbspDR6n',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
```

### Reading/Writing with Fastify

```typescript
// src/stats/stats.controller.ts
import { Controller, Get, Req, Session } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type * as secureSession from '@fastify/secure-session';

@Controller('stats')
export class StatsController {
  @Get()
  getStats(@Session() session: secureSession.Session) {
    const visits = (session.get('visits') as number) || 0;
    session.set('visits', visits + 1);
    return { visits: visits + 1 };
  }
}
```

---

## 5. Security & Session Fixation Mitigation

When using sessions for authentication:
1. **Regenerate Session ID on Login**: Prevent Session Fixation attacks by destroying or regenerating the session identifier whenever user privileges change or upon successful authentication:
   ```typescript
   request.session.regenerate((err) => {
     request.session.userId = authenticatedUser.id;
   });
   ```
2. **Reverse Proxy Trust**: If running behind a reverse proxy (e.g. Nginx, AWS ALB, Traefik), `trust proxy` must be enabled so that `cookie.secure: true` functions accurately over forwarded HTTPS connections.
3. **Strict Cookie Attributes**: Always set `httpOnly: true` (blocks XSS exfiltration) and `sameSite: 'lax'` or `'strict'` (mitigates CSRF).

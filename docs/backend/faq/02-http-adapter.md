# HTTP Adapter & Underlying Engine Access

> **Domain**: HTTP Engine Abstraction, Platform Agnosticism & Runtime Extension  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

NestJS abstracts the underlying HTTP transport engine using the **Adapter Pattern**. Whether running on top of [Express](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/01-first-steps.md) or [Fastify](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/08-performance-fastify.md), all framework components (guards, interceptors, pipes, filters) interact with an implementation of `AbstractHttpAdapter`.

In advanced scenarios—such as mounting third-party middleware incompatible with Nest abstractions, inspecting raw socket states, or reading server listening events—you can access the adapter and the underlying platform engine directly.

---

## 1. Accessing `HttpAdapter` Outside the DI Container

When bootstrapping the application in `src/main.ts`, access the adapter directly from the `INestApplication` instance:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Retrieve the AbstractHttpAdapter instance
  const httpAdapter = app.getHttpAdapter();

  // Retrieve the native platform engine (Express application or Fastify instance)
  const nativeEngine = httpAdapter.getInstance();

  console.log(`Initialized with adapter type: ${httpAdapter.constructor.name}`);

  await app.listen(3000);
}
await bootstrap();
```

---

## 2. Accessing `HttpAdapterHost` Within the DI Container

Inside injectable services, interceptors, or exception filters, inject the `HttpAdapterHost` provider from `@nestjs/core`.

> **Critical Distinction**: `HttpAdapterHost` is **not** the adapter itself. It is a container holding a reference to the active `httpAdapter` property, ensuring that circular DI issues during bootstrap are avoided.

```typescript
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Injectable()
export class NetworkDiagnosticsService implements OnApplicationBootstrap {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const { httpAdapter } = this.adapterHost;

    if (!httpAdapter) {
      return; // Application is running in standalone or microservice-only mode
    }

    // Access native engine methods
    const rawInstance = httpAdapter.getInstance();
    console.log(`Native engine available: ${Boolean(rawInstance)}`);
  }

  getNativeServer(): any {
    return this.adapterHost.httpAdapter.getHttpServer();
  }
}
```

---

## 3. Subscribing to the `listen$` Observable Stream

`HttpAdapterHost` exposes an RxJS `listen$` stream that emits when the underlying HTTP server successfully binds to its port:

```typescript
import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Subscription } from 'rxjs';

@Injectable()
export class ServerStateObserver implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    // 1. Subscribe to reactive listening event
    this.subscription = this.adapterHost.listen$.subscribe(() => {
      console.log('HTTP Server has successfully opened sockets for traffic.');
    });

    // 2. Or poll the synchronous boolean flag
    if (this.adapterHost.listening) {
      console.log('Server is already active and listening.');
    }
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
```

---

## 4. Native Engine Methods: Express vs. Fastify

| Adapter Operation | Express Adapter (`@nestjs/platform-express`) | Fastify Adapter (`@nestjs/platform-fastify`) |
| :--- | :--- | :--- |
| **`getInstance()`** | Returns `express.Application` | Returns `FastifyInstance` |
| **`getHttpServer()`** | Returns native Node.js `http.Server` | Returns native Node.js `http.Server` |
| **`setHeader(res, key, val)`** | `res.setHeader(key, val)` | `res.header(key, val)` |
| **`reply(res, body, status)`** | `res.status(status).send(body)` | `res.status(status).send(body)` |
| **`registerParserMiddleware()`** | Built-in `body-parser` (JSON/Urlencoded) | Content-type parsers via `fastify.addContentTypeParser` |

### Registering Engine-Specific Hooks Directly

```typescript
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

@Injectable()
export class FastifyHookRegistry implements OnApplicationBootstrap {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;

    // Check if running on Fastify
    if (httpAdapter.getType() === 'fastify') {
      const fastify: FastifyInstance = httpAdapter.getInstance();

      fastify.addHook('onRequest', async (req, _reply) => {
        req.raw.headers['x-ingress-received-at'] = Date.now().toString();
      });
    }
  }
}
```

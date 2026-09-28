# Async Local Storage (ALS) & Request Context

> **Domain**: Asynchronous Context Propagation, Request Tracking & High-Performance State  
> **Source Reference**: [NestJS Async Local Storage Recipe](https://docs.nestjs.com/recipes/async-local-storage)  
> **Core Module**: `node:async_hooks` | `@nestjs/observe` | `nestjs-cls`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

`AsyncLocalStorage` (ALS) is a native Node.js API that allows state to be stored and accessed throughout an asynchronous execution chain (e.g. across nested promises, callbacks, and database queries) without explicitly threading a context parameter through every function signature.

In NestJS architectures, ALS provides a high-performance alternative to `Scope.REQUEST` providers. While request-scoped providers force Nest to instantiate new provider instances on every incoming request—increasing memory pressure and latency—ALS operates on standard **singleton** services while preserving isolated per-request state.

---

## 1. Hand-Rolled ALS Architecture

You can implement an ALS request context provider using standard NestJS middleware and dependency injection:

### Step 1: Create the ALS Module (`AlsModule`)

```typescript
// apps/api/src/common/als/als.module.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Module } from '@nestjs/common';

export interface RequestStore {
  userId?: string;
  tenantId?: string;
  correlationId: string;
}

@Global()
@Module({
  providers: [
    {
      provide: AsyncLocalStorage,
      useValue: new AsyncLocalStorage<RequestStore>(),
    },
  ],
  exports: [AsyncLocalStorage],
})
export class AlsModule {}
```

### Step 2: Bind ALS Middleware in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AlsModule, type RequestStore } from './common/als/als.module.js';

@Module({
  imports: [AlsModule],
})
export class AppModule implements NestModule {
  constructor(private readonly als: AsyncLocalStorage<RequestStore>) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req: any, res: any, next: () => void) => {
        const store: RequestStore = {
          userId: req.headers['x-user-id'],
          tenantId: req.headers['x-tenant-id'],
          correlationId: req.headers['x-correlation-id'] || crypto.randomUUID(),
        };

        // Wrap execution chain in the ALS context
        this.als.run(store, () => next());
      })
      .forRoutes('*');
  }
}
```

### Step 3: Accessing the Store in Singleton Services

```typescript
// apps/api/src/users/users.service.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { RequestStore } from '../common/als/als.module.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly als: AsyncLocalStorage<RequestStore>) {}

  findAll() {
    const store = this.als.getStore();
    this.logger.log(`Fetching users for tenant: ${store?.tenantId} [Corr: ${store?.correlationId}]`);
    return [];
  }
}
```

---

## 2. Automated ALS with `@nestjs/observe`

If your application is instrumented with [NestJS Observe](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/01-overview.md), the `@nestjs/observe` SDK already maintains an internal `AsyncLocalStorage` store across every request, BullMQ background job, cron task, and microservice RPC call.

Instead of writing custom middleware, inject `TracerService`:

```typescript
// apps/api/src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

interface OrderContextStore {
  userId: string;
  traceTier: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly tracerService: TracerService<OrderContextStore>) {}

  processOrder() {
    // Read context across any async boundary without function parameter threading
    const userId = this.tracerService.getAttribute('userId');
    const traceId = this.tracerService.currentTraceId();

    return { processedBy: userId, traceId };
  }
}
```

---

## 3. Alternative: `nestjs-cls` Module

The third-party [`nestjs-cls`](https://github.com/Papooch/nestjs-cls) package provides rich developer ergonomics, automated request ID generation, and strong typing:

```bash
pnpm add nestjs-cls
```

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          cls.set('userId', req.headers['x-user-id']);
        },
      },
    }),
  ],
})
export class AppModule {}
```

### Accessing Typed Store via `ClsService`

```typescript
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class CatsService {
  constructor(private readonly cls: ClsService) {}

  getCatForUser() {
    const userId = this.cls.get('userId');
    return { userId };
  }
}
```

### Testing with `ClsService.runWith()`

```typescript
it('executes in mock ALS context', async () => {
  const result = await cls.runWith({ userId: 'user-42' }, () => {
    return catsService.getCatForUser();
  });

  expect(result.userId).toBe('user-42');
});
```

# Microservices: Pre-Request Hooks

> **Source**: https://docs.nestjs.com/microservices/pre-request-hooks  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@nestjs/common`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

**Pre-request hooks** are functions that run before all enhancers (guards, interceptors, and pipes) on every invocation of a message or event pattern handler. They serve as the **microservices equivalent of HTTP middleware**: a deterministic boundary to establish per-request context, propagate distributed trace identifiers, and measure end-to-end execution duration.

---

## 1. Execution Order Pipeline

Pre-request hooks execute at the very ingress of the microservice request lifecycle:

```text
Incoming message / event packet
  └─ Pre-request hooks  (in registration order)
       └─ Guards
            └─ Interceptors (pre)
                 └─ Pipes
                      └─ Handler
```

Exceptions thrown inside a hook are intercepted by the microservice error wrapper, ensuring your configured `RpcExceptionFilter` handles them seamlessly.

---

## 2. Registering Hooks

Register hooks on the microservice application instance using `registerPreRequestHook()` **before calling `app.listen()` or `app.init()`**:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    { transport: Transport.TCP, options: { port: 8877 } },
  );

  // Register pre-request hook
  app.registerPreRequestHook((ctx, next) => {
    // Calling next() advances to the next hook or the guard -> pipe -> handler pipeline
    return next();
  });

  await app.listen();
}
void bootstrap();
```

> [!WARNING]
> **Hook Execution Invariants**:
> 1. **Must Call `next()`**: If a hook does not invoke `next()`, the pipeline halts and the pattern handler is never executed.
> 2. **Must Return Observable**: The hook must return an `Observable` (either directly from `next()` or wrapped in RxJS operators).
> 3. **Timing**: Hooks registered after initialization are ignored and emit a runtime warning. In hybrid applications, pass `deferInitialization: true` if registering hooks after `connectMicroservice()`.
> 4. **Scope**: Pre-request hooks are global to the microservice instance. They do not apply to WebSocket gateways.

---

## 3. Production Use Cases

### 3.1 `AsyncLocalStorage` & Correlation ID Propagation

In distributed event systems, propagating correlation IDs without cluttering handler method signatures is best accomplished by wrapping the execution in Node's `AsyncLocalStorage`:

```typescript
// src/common/als.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  correlationId: string;
  timestamp: number;
}

export const als = new AsyncLocalStorage<RequestStore>();
```

Initialize the store inside the pre-request hook:

```typescript
// src/main.ts
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { als } from './common/als.js';

app.registerPreRequestHook((ctx, next) => {
  const rpcContext = ctx.switchToRpc();
  const rawContext = rpcContext.getContext();

  // Extract correlation ID from NATS/Kafka/RabbitMQ headers or generate fallback
  let correlationId: string | undefined = undefined;
  if (rawContext && typeof rawContext.getHeaders === 'function') {
    correlationId = rawContext.getHeaders()?.['x-correlation-id'];
  }

  const activeId = correlationId || randomUUID();

  return new Observable((subscriber) => {
    als.run({ correlationId: activeId, timestamp: Date.now() }, () => {
      next().subscribe(subscriber);
    });
  });
});
```

Because the hook executes before guards, any guard, pipe, or service can reliably access `als.getStore()`:

```typescript
// src/common/guards/correlation.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { als } from '../als.js';

@Injectable()
export class CorrelationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const store = als.getStore();
    console.log(`Guard executing for correlationId: ${store?.correlationId}`);
    return true;
  }
}
```

### 3.2 End-to-End Latency & Telemetry Metrics

```typescript
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Logger } from '@nestjs/common';

const logger = new Logger('MicroserviceMetrics');

app.registerPreRequestHook((ctx, next) => {
  const handlerName = ctx.getHandler().name;
  const startTime = performance.now();

  return next().pipe(
    tap(() => {
      const elapsed = (performance.now() - startTime).toFixed(2);
      logger.log(`[Handler: ${handlerName}] executed successfully in ${elapsed}ms`);
    }),
    catchError((err) => {
      const elapsed = (performance.now() - startTime).toFixed(2);
      logger.error(`[Handler: ${handlerName}] failed after ${elapsed}ms: ${err.message}`);
      return throwError(() => err);
    }),
  );
});
```

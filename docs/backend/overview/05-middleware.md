# 05 - Middleware

> **Source Reference**: [NestJS Official Documentation - Middleware](https://docs.nestjs.com/middleware)

Middleware is a function that is executed **before** the route handler is invoked. Middleware functions have access to the platform `Request` and `Response` objects, and the `next()` function in the application's request-response cycle.

---

## 1. Capabilities & Mechanics

Middleware functions can:
* Execute arbitrary code (e.g. logging, metrics, tracing).
* Inspect and modify incoming `request` and `response` objects (e.g. attaching user sessions or correlation IDs).
* End the request-response cycle immediately (e.g. returning early on unauthorized header).
* Call `next()` to pass control to the next middleware function in the stack.

> **Crucial Rule**: If a middleware function does not terminate the request-response cycle, it **must** call `next()`; otherwise, the request will hang indefinitely.

---

## 2. Class Middleware vs. Functional Middleware

### Class-Based Middleware (Supports Dependency Injection)
Class-based middleware is an `@Injectable()` class implementing the `NestMiddleware` interface:

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../../logger/logger.service.js';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    this.logger.debug(`Inbound request [${req.method}] ${req.url} (ID: ${correlationId})`);
    next();
  }
}
```

### Functional Middleware (Lightweight & Dependency-Free)
When middleware requires no dependencies and has no internal state, a plain function is cleaner and faster:

```typescript
import type { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
  next();
}
```

---

## 3. Applying Middleware via `MiddlewareConsumer`

Middleware cannot be listed in the `@Module()` decorator metadata. Instead, it is configured inside a module's `configure()` method. The module must implement the `NestModule` interface:

```typescript
import { Module, type NestModule, type MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { UsersController } from './users/users.controller.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [UsersModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes(UsersController); // Bound to all routes in UsersController
  }
}
```

---

## 4. Route Scoping & Wildcards

### 1. Specific Path & HTTP Method
To apply middleware only to specific paths or HTTP verbs:
```typescript
consumer
  .apply(CorrelationIdMiddleware)
  .forRoutes(
    { path: 'users', method: RequestMethod.POST },
    { path: 'orders/{*splat}', method: RequestMethod.ALL },
  );
```

### 2. Wildcards & Optional Patterns
* `orders/*splat`: Matches `orders/123`, `orders/items/456`.
* `orders/{*splat}`: Matches `orders` itself as well as nested sub-paths.

---

## 5. Route Exclusion

To bind middleware to a controller while bypassing specific routes:

```typescript
consumer
  .apply(AuthMiddleware)
  .exclude(
    { path: 'auth/login', method: RequestMethod.POST },
    { path: 'auth/register', method: RequestMethod.POST },
    'health',
  )
  .forRoutes(AuthController, UsersController);
```

---

## 6. Multiple Middleware Chaining

Multiple middleware functions execute in the exact order they are passed to `.apply()`:

```typescript
consumer
  .apply(helmetMiddleware, corsMiddleware, CorrelationIdMiddleware)
  .forRoutes('*');
```

---

## 7. Global Middleware

There are two ways to bind middleware globally across all routes:

### Approach A: `app.use()` (Outside Nest IoC)
```typescript
// in main.ts
const app = await NestFactory.create(AppModule);
app.use(requestLogger);
await app.listen(3001);
```
> **Limitation**: Global middleware bound with `app.use()` cannot access the NestJS Dependency Injection container.

### Approach B: `forRoutes('*')` in `AppModule` (Supports DI)
```typescript
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```
> **Advantage**: Full access to injected services and module providers.

---

## 8. Error Handling & Exception Filter Caveat

When middleware throws an exception:
```typescript
@Injectable()
export class TokenVerificationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (!req.headers.authorization) {
      throw new UnauthorizedException('Authorization header is missing');
    }
    next();
  }
}
```

> **CRITICAL ARCHITECTURAL WARNING**: Because middleware executes **before** a route handler is selected by the router:
> * Method-scoped and controller-scoped `@UseFilters()` are **NOT invoked** for exceptions originating in middleware.
> * Only **global exception filters** (`app.useGlobalFilters()` or providers registered with `APP_FILTER`) will catch exceptions thrown from middleware!

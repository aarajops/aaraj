# 09 - Interceptors

> **Source Reference**: [NestJS Official Documentation - Interceptors](https://docs.nestjs.com/interceptors)

An interceptor is an `@Injectable()` class implementing the `NestInterceptor` interface. Interceptors are inspired by **Aspect-Oriented Programming (AOP)** techniques.

Interceptors enable you to:
* Bind custom logic before or after method execution.
* Transform the result returned from a function.
* Transform the exception thrown from a function.
* Completely override handler execution (e.g. returning cached results).
* Enforce timeouts or clean up open resources.

---

## 1. The `NestInterceptor` Contract & `CallHandler`

Every interceptor implements the `intercept()` method:

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

@Injectable()
export class SampleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 1. Code executed BEFORE the route handler is invoked
    console.log('Pre-handler execution');

    // 2. Calling next.handle() invokes the route handler Pointcut
    return next.handle();
  }
}
```

> **CRITICAL RULE**: If your interceptor does not invoke `next.handle()`, the underlying route handler will **never** be executed.

---

## 2. Practical Patterns & Use Cases

### Pattern 1: Performance Timing & Logging (`tap`)
Using the RxJS `tap()` operator to observe the stream without altering the response data:

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.url;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - now;
        this.logger.log(`[${method}] ${url} +${elapsed}ms`);
      }),
    );
  }
}
```

---

### Pattern 2: Standardized Response Envelopes (`map`)
Enforcing a uniform JSON structure across all API endpoints:

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponseEnvelope<T> {
  success: boolean;
  timestamp: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponseEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseEnvelope<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        timestamp: new Date().toISOString(),
        data,
      })),
    );
  }
}
```

> **Warning with `@Res()`**: Response transformation with `map()` requires Nest's declarative response handling. If a route handler uses `@Res()` directly, response mapping is bypassed unless `@Res({ passthrough: true })` is used.

---

### Pattern 3: Stream Overriding for Caching (`of`)
If data exists in an in-memory or Redis cache, the interceptor can return an RxJS `of(cachedData)` stream directly, bypassing the controller and database completely:

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { of, type Observable } from 'rxjs';

@Injectable()
export class InMemoryCacheInterceptor implements NestInterceptor {
  private readonly cache = new Map<string, unknown>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const cacheKey = `${req.method}:${req.url}`;

    if (this.cache.has(cacheKey)) {
      // Overrides stream: handler is NEVER called
      return of(this.cache.get(cacheKey));
    }

    return next.handle().pipe(
      map((data) => {
        this.cache.set(cacheKey, data);
        return data;
      }),
    );
  }
}
```

---

### Pattern 4: Request Timeouts (`timeout`)
Protecting the server from slow downstream calls or hanging queries by failing requests that exceed a latency threshold:

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { type Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(5000), // Enforce 5 second timeout
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException('Request processing timed out'));
        }
        return throwError(() => err);
      }),
    );
  }
}
```

---

## 3. Binding Interceptors

### 1. Controller-Scoped
```typescript
@Controller('catalog')
@UseInterceptors(TransformInterceptor)
export class CatalogController {}
```

### 2. Method-Scoped
```typescript
@Get('heavy-query')
@UseInterceptors(TimeoutInterceptor)
getHeavyData() {}
```

### 3. Global-Scoped with Dependency Injection (`APP_INTERCEPTOR`)
```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
```

# Microservices: Interceptors

> **Source**: https://docs.nestjs.com/microservices/interceptors  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@nestjs/common`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Interceptors](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/overview/09-interceptors.md) in microservices wrap the execution of pattern handlers using RxJS observable streams, enabling Aspect-Oriented Programming (AOP) across distributed messaging topologies.

---

## 1. Capabilities & Execution Model

Because Nest microservices communicate natively through RxJS `Observable` streams, interceptors can:
- Mutate the payload returned to the caller.
- Inject performance timing and emit distributed tracing metrics.
- Apply execution timeouts using RxJS `timeout()`.
- Transform thrown errors before they reach the exception filter.

---

## 2. Production Response Enveloping Interceptor

The following interceptor wraps all successful `@MessagePattern()` responses in a standardized envelope:

```typescript
// src/common/interceptors/rpc-transform.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface RpcStandardEnvelope<T> {
  success: true;
  meta: {
    timestamp: string;
    durationMs: number;
  };
  payload: T;
}

@Injectable()
export class RpcTransformInterceptor<T>
  implements NestInterceptor<T, RpcStandardEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<RpcStandardEnvelope<T>> {
    if (context.getType() !== 'rpc') {
      return next.handle() as any;
    }

    const startTime = performance.now();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        meta: {
          timestamp: new Date().toISOString(),
          durationMs: Number((performance.now() - startTime).toFixed(2)),
        },
        payload: data,
      })),
    );
  }
}
```

---

## 3. Binding Scopes

```typescript
// src/catalog/catalog.controller.ts
import { Controller, UseInterceptors } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcTransformInterceptor } from '../common/interceptors/rpc-transform.interceptor.js';

@UseInterceptors(RpcTransformInterceptor)
@Controller()
export class CatalogController {
  @MessagePattern({ cmd: 'catalog.find' })
  findItem(@Payload() id: string) {
    return { id, name: 'Item Name' };
  }
}
```

> [!NOTE]
> In hybrid applications, global interceptors configured via `app.useGlobalInterceptors()` do not apply to microservices unless `inheritAppConfig: true` is configured.

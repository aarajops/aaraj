# Microservices: Exception Filters

> **Source**: https://docs.nestjs.com/microservices/exception-filters  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The microservices exception handling layer parallels the HTTP [exception filter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/overview/06-exception-filters.md) architecture, with two critical architectural distinctions:
1. **Exception Type**: Handlers must throw `RpcException` rather than `HttpException`.
2. **Observable Return Contract**: The `catch()` method of an `RpcExceptionFilter` **must return an RxJS `Observable`** rather than writing directly to an HTTP response stream.

---

## 1. The `RpcException` Class & Error Format

To communicate an error to the calling client across a message broker, throw `RpcException`:

```typescript
import { RpcException } from '@nestjs/microservices';

throw new RpcException('Invalid order payload.');
```

Nest catches the exception and serializes an error frame back to the client:

```json
{
  "status": "error",
  "message": "Invalid order payload."
}
```

If an object is passed to `new RpcException({ code: 'ERR_INSUFFICIENT_FUNDS', retryable: false })`, Nest transmits that exact object as the payload.

> [!WARNING]
> **Event Handler Error Boundary (`@EventPattern`)**:
> An event handler has no response stream. An error rethrown by an exception filter handling an `@EventPattern()` will **never reach the producer**. You must handle the failure inside the filter (e.g., logging to an APM, sending dead-letter packets, or triggering alerting pipelines).

---

## 2. Authoring Custom `RpcExceptionFilter`

```typescript
// src/common/filters/custom-rpc-exception.filter.ts
import { Catch, RpcExceptionFilter, ArgumentsHost, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';

@Catch(RpcException)
export class CustomRpcExceptionFilter implements RpcExceptionFilter<RpcException> {
  private readonly logger = new Logger(CustomRpcExceptionFilter.name);

  catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
    const rpcContext = host.switchToRpc();
    const data = rpcContext.getData();
    const errorDetails = exception.getError();

    this.logger.error(`RPC Exception on payload ${JSON.stringify(data)}:`, errorDetails);

    // Return an Observable error stream containing the error payload
    return throwError(() => ({
      success: false,
      error: errorDetails,
      timestamp: new Date().toISOString(),
    }));
  }
}
```

---

## 3. Extending `BaseRpcExceptionFilter`

To extend default serialization behavior with enterprise metrics or audit trails:

```typescript
// src/common/filters/all-rpc-exceptions.filter.ts
import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseRpcExceptionFilter } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Catch()
export class AllRpcExceptionsFilter extends BaseRpcExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionsFilter.name);

  override catch(exception: any, host: ArgumentsHost): Observable<any> {
    const rpc = host.switchToRpc();
    this.logger.error(
      `Unhandled RPC exception caught: ${exception.message || JSON.stringify(exception)}`,
      exception.stack,
    );

    // Delegate serialization to core NestJS filter
    return super.catch(exception, host);
  }
}
```

---

## 4. Binding Filters & Hybrid Application Inheritance

Exception filters can be bound at the method level, controller level, or globally:

```typescript
// Controller-scoped binding
@UseFilters(new CustomRpcExceptionFilter())
@Controller()
export class OrdersController {}
```

> [!IMPORTANT]
> **Hybrid Applications & `inheritAppConfig`**:
> Global filters registered on the primary HTTP application (`app.useGlobalFilters()`) **do not apply** to connected microservices by default. In a hybrid application, you must explicitly enable `inheritAppConfig: true`:
> ```typescript
> app.connectMicroservice<MicroserviceOptions>(microserviceConfig, {
>   inheritAppConfig: true,
> });
> ```

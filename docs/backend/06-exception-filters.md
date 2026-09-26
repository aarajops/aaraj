# 06 - Exception Filters

> **Source Reference**: [NestJS Official Documentation - Exception Filters](https://docs.nestjs.com/exception-filters)

Nest comes with a built-in **exceptions layer** that processes all unhandled exceptions across an application. When application code throws an uncaught error, this layer intercepts it, formats the error payload, and delivers an appropriate, user-friendly HTTP response to the client.

---

## 1. Built-in Global Exception Handling

By default, Nest provides a built-in global exception filter:
* **Instances of `HttpException`** (and its subclasses): Handled automatically. The HTTP status code and message provided by the error are returned.
* **Unrecognized Exceptions** (e.g. plain `Error`, `TypeError`, database connection failures): Transformed into a standard `500 Internal Server Error` payload to prevent leaking sensitive internal stack traces to clients:
  ```json
  {
    "statusCode": 500,
    "message": "Internal server error"
  }
  ```

---

## 2. Standard Built-in HTTP Exceptions

Nest exports standard exceptions from `@nestjs/common` corresponding to HTTP status codes:

| Exception Class | HTTP Status Code | Default Semantic Meaning |
| :--- | :--- | :--- |
| `BadRequestException` | `400 Bad Request` | Client validation failed or malformed request syntax |
| `UnauthorizedException` | `401 Unauthorized` | Authentication credentials missing or invalid |
| `ForbiddenException` | `403 Forbidden` | Authenticated user lacks sufficient permissions |
| `NotFoundException` | `404 Not Found` | Target resource does not exist |
| `MethodNotAllowedException`| `405 Method Not Allowed` | Target resource does not support this HTTP verb |
| `NotAcceptableException` | `406 Not Acceptable` | Client cannot accept the response format |
| `RequestTimeoutException` | `408 Request Timeout` | Request exceeded server processing window |
| `ConflictException` | `409 Conflict` | Unique constraint violation or state conflict |
| `GoneException` | `410 Gone` | Resource has been permanently deleted |
| `PayloadTooLargeException` | `413 Payload Too Large`| Request body exceeds allowed size limit |
| `UnsupportedMediaTypeException`| `415 Unsupported Media Type` | Content-Type header is unsupported |
| `UnprocessableEntityException` | `422 Unprocessable Entity` | Syntax is valid but semantic validation failed |
| `InternalServerErrorException` | `500 Internal Server Error` | Unexpected runtime failure |
| `NotImplementedException` | `501 Not Implemented` | Endpoint or capability is not yet implemented |
| `BadGatewayException` | `502 Bad Gateway` | Downstream external service returned invalid response |
| `ServiceUnavailableException`| `503 Service Unavailable` | Server is temporarily overloaded or in maintenance |
| `GatewayTimeoutException` | `504 Gateway Timeout` | Downstream external service timed out |

---

## 3. Throwing Standard Exceptions & Machine-Readable Error Codes

### Standard Throw
```typescript
import { NotFoundException } from '@nestjs/common';

if (!user) {
  throw new NotFoundException(`User with ID ${id} not found`);
}
```

### Machine-Readable Error Codes (`errorCode`)
Human-readable messages (`"Invalid password"`, `"Email is taken"`) are difficult for frontend clients to branch on cleanly. Nest allows passing a stable, machine-readable `errorCode`:

```typescript
import { BadRequestException } from '@nestjs/common';

throw new BadRequestException('Password does not meet complexity requirements', {
  errorCode: 'AUTH_WEAK_PASSWORD',
  description: 'Password must include uppercase, numbers, and symbols',
});
```

Serialized JSON Response:
```json
{
  "message": "Password does not meet complexity requirements",
  "error": "Password must include uppercase, numbers, and symbols",
  "errorCode": "AUTH_WEAK_PASSWORD",
  "statusCode": 400
}
```

### Error Causes (`cause`)
The optional third parameter accepts a `cause` object, storing the underlying root cause for logging without exposing it in the public API response:

```typescript
try {
  await this.db.save(data);
} catch (dbError) {
  throw new InternalServerErrorException('Persistence failure', {
    cause: dbError, // Preserved for observability, never sent to client
  });
}
```

---

## 4. Custom Exceptions

To enforce domain semantics, create custom exception hierarchies that extend `HttpException`:

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';

export class TenantSuspendedException extends HttpException {
  constructor(tenantId: string) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        message: `Tenant ${tenantId} is suspended`,
        errorCode: 'TENANT_SUSPENDED',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
```

---

## 5. Custom Exception Filters

When you need complete control over response payloads, error headers, or audit logging, implement an `ExceptionFilter`:

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorPayload = typeof exceptionResponse === 'object'
      ? (exceptionResponse as Record<string, unknown>)
      : { message: exceptionResponse };

    this.logger.warn(`[${request.method}] ${request.url} - ${status} - ${JSON.stringify(errorPayload)}`);

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...errorPayload,
    });
  }
}
```

---

## 6. Catch-All Exception Filter (`@Catch()`)

Leaving `@Catch()` empty catches **every** unhandled exception, including unexpected system errors. To maintain platform independence across Express and Fastify, use `HttpAdapterHost`:

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      message: exception instanceof HttpException ? exception.message : 'Internal server error',
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
```

---

## 7. Binding Exception Filters

### 1. Method-Scoped
```typescript
@Post()
@UseFilters(HttpExceptionFilter)
createItem() {}
```

### 2. Controller-Scoped
```typescript
@Controller('users')
@UseFilters(HttpExceptionFilter)
export class UsersController {}
```

### 3. Global-Scoped with Dependency Injection (`APP_FILTER`)
When a global filter depends on other injected services (such as a database logger or metrics collector), register it as a multi-provider token in `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

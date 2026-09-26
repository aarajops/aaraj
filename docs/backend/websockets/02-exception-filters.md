# WebSockets: Exception Filters

> **Source**: https://docs.nestjs.com/websockets/exception-filters  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The WebSockets exception layer mirrors the architectural model of HTTP [exception filters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/06-exception-filters.md), but is tailored to bidirectional messaging protocols. When an unhandled error occurs within a gateway message handler, pipe, guard, or interceptor, Nest catches the error and serializes an exception frame back to the calling client over the open socket connection.

The fundamental difference lies in the exception class: instead of throwing `HttpException`, real-time handlers must throw `WsException`.

---

## 1. The `WsException` Class & Error Frame Format

To report an error back to the connected client, instantiate and throw `WsException`:

```typescript
import { WsException } from '@nestjs/websockets';

throw new WsException('Invalid credentials.');
```

### 1.1 Wire Protocol Response Shape

When a handler throws `WsException`, Nest intercepts it and automatically emits an `exception` event to the client with the following payload structure:

```json
{
  "status": "error",
  "message": "Invalid credentials.",
  "cause": {
    "pattern": "events",
    "data": { "name": "Nest" }
  }
}
```

The `cause` property provides contextual telemetry, allowing the client to match the failure to the specific message event (`pattern`) and payload (`data`) that triggered it.

- **Object Payloads**: If you pass an object (rather than a string) to `new WsException({ code: 'ERR_AUTH', details: 'Expired token' })`, Nest emits that object as the `message` payload.
- **Non-`WsException` Errors**: Any standard JavaScript exception (such as `new Error('DB failure')` or `HttpException`) is caught by the core filter and translated into a generic `'Internal server error'` message to avoid leaking internal stack traces.
- **Native `ws` Protocol Behavior**: Because the native `ws` driver does not support named Socket.IO event packets, clients receive a single JSON string formatted as:
  ```json
  { "event": "exception", "data": { "status": "error", "message": "Invalid credentials." } }
  ```

---

## 2. Binding Exception Filters

Exception filters in WebSockets can be applied at the **gateway level** or at the **method level**:

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  UseFilters,
  WsResponse,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { CustomWsExceptionFilter } from './custom-ws-exception.filter.js';

// Gateway-scoped: All message handlers within this gateway use this filter
@UseFilters(new CustomWsExceptionFilter())
@WebSocketGateway({ namespace: 'orders' })
export class OrdersGateway {
  // Method-scoped filter override
  @UseFilters(CustomWsExceptionFilter)
  @SubscribeMessage('createOrder')
  handleCreateOrder(
    @MessageBody() orderData: unknown,
    @ConnectedSocket() client: Socket,
  ): WsResponse<unknown> {
    return { event: 'orderCreated', data: { id: 'ORD-123' } };
  }
}
```

> [!WARNING]
> **Global Exception Filters Do Not Apply to Gateways**:
> Global filters registered via `app.useGlobalFilters()` or the `APP_FILTER` provider token apply **only to HTTP requests**. They will not intercept unhandled errors thrown inside WebSocket gateways. You must bind WebSocket filters at the class or handler level using `@UseFilters()`.

---

## 3. Extending the Core Filter (`BaseWsExceptionFilter`)

Rather than authoring an exception filter entirely from scratch, enterprise applications often extend the built-in `BaseWsExceptionFilter` to add centralized structured logging, audit trails, and selective error transformations while delegating default wire serialization to the framework.

```typescript
// src/common/filters/all-ws-exceptions.filter.ts
import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class AllWsExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(AllWsExceptionsFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    const wsContext = host.switchToWs();
    const client = wsContext.getClient<Socket>();
    const data = wsContext.getData<unknown>();
    const pattern = wsContext.getPattern();

    this.logger.error(
      `WS Exception on event [${pattern}] from socket [${client.id}]:`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    // Delegate serialization and emission to BaseWsExceptionFilter
    super.catch(exception, host);
  }
}
```

### 3.1 Customizing `cause` in `BaseWsExceptionFilter`

The `BaseWsExceptionFilter` constructor accepts an options object allowing fine-grained control over how `cause` details are exposed:

```typescript
import { Catch, ArgumentsHost } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';

@Catch()
export class SecureWsExceptionFilter extends BaseWsExceptionFilter {
  constructor() {
    super({
      // Strip 'cause' from error payloads in production to prevent data leaks
      includeCause: process.env.NODE_ENV !== 'production',
      // Or provide a custom cause factory
      causeFactory: (pattern, data) => ({
        timestamp: new Date().toISOString(),
        event: pattern,
      }),
    });
  }
}
```

---

## 4. Complete Production Filter: Custom Schema Error Formatting

In production, you often want consistent error shapes that unify domain validation errors, authentication failures, and internal database exceptions into a predictable schema contract.

```typescript
// src/common/filters/production-ws-exception.filter.ts
import { Catch, ArgumentsHost, WsExceptionFilter, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export interface StandardWsErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    pattern?: string;
  };
}

@Catch()
export class ProductionWsExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger(ProductionWsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ws = host.switchToWs();
    const client = ws.getClient<Socket>();
    const pattern = ws.getPattern();

    let errorCode = 'INTERNAL_ERROR';
    let errorMessage = 'An unexpected internal error occurred.';
    let errorDetails: unknown = undefined;

    if (exception instanceof WsException) {
      const errorPayload = exception.getError();
      if (typeof errorPayload === 'string') {
        errorMessage = errorPayload;
        errorCode = 'WS_BAD_REQUEST';
      } else if (typeof errorPayload === 'object' && errorPayload !== null) {
        const customObj = errorPayload as Record<string, unknown>;
        errorCode = (customObj.code as string) ?? 'WS_ERROR';
        errorMessage = (customObj.message as string) ?? 'WebSocket operation failed';
        errorDetails = customObj.details ?? customObj;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled system exception on [${pattern}]: ${exception.message}`, exception.stack);
      // Mask raw internal errors from client in production
      errorMessage = 'Internal server error';
    }

    const payload: StandardWsErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString(),
        pattern,
      },
    };

    // Emit standardized error event to the client
    client.emit('exception', payload);
  }
}
```

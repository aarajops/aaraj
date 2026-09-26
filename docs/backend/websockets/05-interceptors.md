# WebSockets: Interceptors

> **Source**: https://docs.nestjs.com/websockets/interceptors  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Interceptors](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/09-interceptors.md) in WebSockets bring Aspect-Oriented Programming (AOP) to real-time messaging pipelines. They allow you to:
- Bind extra logic before and after message handler execution.
- Measure execution duration and emit performance metrics.
- Mutate or envelope the response returned by a message handler.
- Extend basic error handling or attach operational telemetry.

Because NestJS abstracts the transport layer using RxJS `Observable` streams, WebSocket interceptors implement the exact same `NestInterceptor` interface as HTTP interceptors.

---

## 1. The Direct Emit Caveat

> [!WARNING]
> **Direct `client.emit()` Bypasses Interceptors**:
> Interceptors observe and transform **only the return value** (or `WsResponse` stream) of a message handler. If you emit messages imperatively using `client.emit('event', data)`, the packet is transmitted directly over the socket driver and completely bypasses the interceptor pipeline.
> 
> To ensure your interceptors execute and format payloads correctly, always return values or `WsResponse` objects from your `@SubscribeMessage()` handlers.

---

## 2. Binding Interceptors

Interceptors can be scoped at the method, gateway, or global level:

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  UseInterceptors,
  WsResponse,
} from '@nestjs/websockets';
import { WsBenchmarkInterceptor } from './interceptors/ws-benchmark.interceptor.js';
import { WsEnvelopeInterceptor } from './interceptors/ws-envelope.interceptor.js';

// Gateway-scoped: All message handlers within this gateway are intercepted
@UseInterceptors(WsBenchmarkInterceptor)
@WebSocketGateway({ namespace: 'analytics' })
export class AnalyticsGateway {
  // Method-scoped interceptor
  @UseInterceptors(WsEnvelopeInterceptor)
  @SubscribeMessage('trackEvent')
  handleTrackEvent(@MessageBody() payload: { action: string }): WsResponse<{ recorded: boolean }> {
    return {
      event: 'eventTracked',
      data: { recorded: true },
    };
  }
}
```

Global interceptors registered via `app.useGlobalInterceptors()` or the `APP_INTERCEPTOR` provider token automatically apply to WebSocket gateways.

---

## 3. Production Interceptors

### 3.1 Performance & Latency Benchmark Interceptor

The following interceptor logs the execution time of each WebSocket message, recording the socket ID, event pattern, and milliseconds elapsed:

```typescript
// src/common/interceptors/ws-benchmark.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Socket } from 'socket.io';

@Injectable()
export class WsBenchmarkInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WsBenchmarkInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'ws') {
      return next.handle();
    }

    const ws = context.switchToWs();
    const client = ws.getClient<Socket>();
    const pattern = ws.getPattern();
    const startTime = performance.now();

    return next.handle().pipe(
      tap(() => {
        const elapsed = (performance.now() - startTime).toFixed(2);
        this.logger.debug(
          `[WS Event] socket=${client.id} event="${pattern}" duration=${elapsed}ms`,
        );
      }),
    );
  }
}
```

### 3.2 Response Envelope Transformation Interceptor

When client applications expect consistent payload formatting across all WebSocket responses, this interceptor wraps handler responses into a structured envelope:

```typescript
// src/common/interceptors/ws-envelope.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { WsResponse } from '@nestjs/websockets';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WsStandardEnvelope<T> {
  success: true;
  meta: {
    timestamp: string;
    durationMs?: number;
  };
  payload: T;
}

@Injectable()
export class WsEnvelopeInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    if (context.getType() !== 'ws') {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      map((response) => {
        const now = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        // If handler returned a WsResponse ({ event, data })
        if (
          response &&
          typeof response === 'object' &&
          'event' in response &&
          'data' in response
        ) {
          const wsResp = response as WsResponse<unknown>;
          return {
            event: wsResp.event,
            data: {
              success: true,
              meta: { timestamp: now, durationMs },
              payload: wsResp.data,
            },
          };
        }

        // Standard acknowledgment return value
        return {
          success: true,
          meta: { timestamp: now, durationMs },
          payload: response,
        };
      }),
    );
  }
}
```

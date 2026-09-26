# 06 - Server-Sent Events (SSE)

> **Source Reference**: [NestJS Official Documentation - Server-Sent Events](https://docs.nestjs.com/http/server-sent-events)

Server-Sent Events (SSE) is an HTTP-native server push standard that allows a client to maintain a persistent connection and receive real-time text updates (`text/event-stream`) from the server. 

Compared to WebSockets, SSE:
- Operates over standard HTTP (natively benefiting from HTTP/2 multiplexing, TLS, and corporate proxies without protocol upgrade handshakes).
- Includes automatic client reconnection and event ID tracking out of the box in the browser's `EventSource` API.
- Is unidirectional (server-to-client), making it the ideal architectural choice for notification feeds, live logs, background job tracking, and LLM text streaming.

---

## 1. Basic SSE Route Implementation

SSE route handlers are decorated with **`@Sse()`** and must return an RxJS **`Observable<MessageEvent>`** (or a `Promise` resolving to one).

```typescript
// src/events/notifications.controller.ts
import { Controller, Sse } from '@nestjs/common';
import { interval, map, Observable } from 'rxjs';

export interface MessageEvent {
  data?: string | object;
  id?: string;
  type?: string;
  retry?: number;
  comment?: string;
}

@Controller('notifications')
export class NotificationsController {
  @Sse('live')
  streamLiveEvents(): Observable<MessageEvent> {
    return interval(2000).pipe(
      map((sequence) => ({
        id: String(sequence),
        type: 'heartbeat',
        data: {
          timestamp: new Date().toISOString(),
          status: 'healthy',
        },
      })),
    );
  }
}
```

### The `MessageEvent` Specification

| Property | Type | Description |
| :--- | :--- | :--- |
| `data` | `string \| object` | The payload. Objects are automatically serialized to JSON. |
| `id` | `string` | Unique event ID. Clients send `Last-Event-ID` on reconnection to resume state. |
| `type` | `string` | Custom event name dispatched in the client `EventSource.addEventListener(type, ...)`. |
| `retry` | `number` | Informs the client browser how many milliseconds to wait before attempting reconnect. |
| `comment` | `string` | SSE comment line (`: comment`). Ignored by `EventSource`; useful for keep-alives. |

---

## 2. Browser Client Consumption (`EventSource`)

```typescript
// Client-side Web / Frontend implementation
const eventSource = new EventSource('/api/notifications/live');

// Standard message listener (events without explicit type)
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received generic event:', data);
};

// Custom event listener matching message.type = 'heartbeat'
eventSource.addEventListener('heartbeat', (event: MessageEvent) => {
  const data = JSON.parse(event.data);
  console.log('Heartbeat received:', data);
});

// Handling connection errors
eventSource.onerror = (err) => {
  console.error('SSE connection error:', err);
};

// Teardown when unmounting component
// eventSource.close();
```

---

## 3. Disconnection Handling & Resource Cleanup

When a client closes the connection (browser tab closed or `eventSource.close()` called), NestJS automatically unsubscribes from the returned `Observable`.

Use the RxJS **`finalize()`** operator to execute teardown logic and prevent memory leaks:

```typescript
// src/events/telemetry.controller.ts
import { Controller, Sse } from '@nestjs/common';
import { finalize, interval, map, Observable } from 'rxjs';

@Controller('telemetry')
export class TelemetryController {
  @Sse('metrics')
  streamMetrics(): Observable<MessageEvent> {
    console.log('Client connected to metrics stream');

    return interval(1000).pipe(
      map((count) => ({
        data: { cpu: Math.random() * 100, memory: process.memoryUsage().heapUsed },
      })),
      finalize(() => {
        console.log('Client disconnected from metrics stream. Releasing resources...');
      }),
    );
  }
}
```

---

## 4. Async Setup & Leak Prevention with `@SseSignal()`

In real-world applications, initializing an SSE stream often requires asynchronous work before returning the observable (e.g. acquiring a database cursor, authenticating an upstream feed, or binding a Redis listener):

```typescript
@Sse('stream')
async stream(): Promise<Observable<MessageEvent>> {
  const session = await createExpensiveSession(); // Async setup
  return new Observable(...);
}
```

> [!CAUTION]
> **The Async Connection Gap**:
> If the client disconnects **while the asynchronous promise is still resolving**, NestJS never subscribes to the resulting `Observable` because the client socket has already vanished. Consequently, the `Observable` teardown function never runs, leaking the expensive external session!

### Closing the Gap with `@SseSignal()`

NestJS provides the **`@SseSignal()`** decorator to inject the request's native `AbortSignal`.

```typescript
// src/events/feed.controller.ts
import { Controller, Sse, SseSignal } from '@nestjs/common';
import { EMPTY, Observable } from 'rxjs';

@Controller('feed')
export class FeedController {
  @Sse('live')
  async streamLiveFeed(@SseSignal() signal: AbortSignal): Promise<Observable<MessageEvent>> {
    // 1. Check if client disconnected before setup completes
    const session = await this.acquireExternalSession();

    if (signal.aborted) {
      await session.close();
      return EMPTY;
    }

    // 2. Pass signal to downstream fetch or wire cleanup
    return new Observable<MessageEvent>((subscriber) => {
      const onData = (payload: unknown) => subscriber.next({ data: payload });
      const onError = (err: unknown) => subscriber.error(err);

      session.on('data', onData);
      session.on('error', onError);

      // Observable teardown
      return () => {
        session.off('data', onData);
        session.off('error', onError);
        session.close();
      };
    });
  }

  private async acquireExternalSession() {
    return {
      on: (ev: string, fn: any) => {},
      off: (ev: string, fn: any) => {},
      close: async () => {},
    };
  }
}
```

### Signal Lifetime Semantics

The `AbortSignal` injected by `@SseSignal()` represents the complete lifetime of the **SSE HTTP response**. It triggers an abort event when:
1. The client disconnects prematurely.
2. The `Observable` completes.
3. The `Observable` emits an unhandled error.

Always ensure external teardown handlers attached to the signal are **idempotent**, as both the signal event and the `Observable` teardown may execute during teardown.

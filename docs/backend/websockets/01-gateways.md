# WebSockets: Gateways

> **Source**: https://docs.nestjs.com/websockets/gateways  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

A **Gateway** in NestJS is a specialized class annotated with the `@WebSocketGateway()` decorator. Gateways act as the real-time counterpart to HTTP controllers: they listen for incoming client connections, subscribe to incoming message events, route payloads through pipes and guards, and dispatch responses back to individual sockets, rooms, or entire namespaces.

Because gateways are platform-agnostic [providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/03-providers.md), they participate fully in Nest's Dependency Injection (DI) container. They can inject repositories and services, and controllers or services can inject the gateway itself to trigger push notifications to connected clients.

---

## 1. Installation & Driver Setup

To build real-time applications with Socket.IO, install the core WebSockets module and the official platform driver:

```bash
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

If your workload requires ultra-fast, native WebSockets without Socket.IO overhead, install the `ws` platform package instead:

```bash
pnpm add @nestjs/websockets @nestjs/platform-ws ws
pnpm add -D @types/ws
```

---

## 2. Overview & Decorator Options

By default, a gateway listens on the **same port as the underlying HTTP server** (Express or Fastify) via connection upgrade multiplexing.

### 2.1 Custom Ports and Namespaces

To bind the gateway to a dedicated TCP port or isolate communication into a distinct [Socket.IO namespace](https://socket.io/docs/v4/namespaces/), pass configuration arguments to `@WebSocketGateway()`:

```typescript
import { WebSocketGateway } from '@nestjs/websockets';

// Dedicated port 8080 with an isolated namespace
@WebSocketGateway(8080, {
  namespace: 'chat',
  transports: ['websocket'],
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway {}
```

If you do not need a custom port and wish to multiplex over the primary HTTP port, supply the options object as the first parameter:

```typescript
@WebSocketGateway({
  namespace: 'events',
  cors: { origin: 'https://admin.araz.io' },
})
export class EventsGateway {}
```

> [!WARNING]
> Gateways are not instantiated until they are explicitly listed in the `providers` array of a registered NestJS module.

### 2.2 Module Registration

Register the gateway inside a feature module:

```typescript
// src/events/events.module.ts
import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { ConnectionStateService } from './connection-state.service.js';

@Module({
  providers: [EventsGateway, ConnectionStateService],
  exports: [EventsGateway],
})
export class EventsModule {}
```

---

## 3. Subscribing to Messages & Handling Payloads

A message handler is a method decorated with `@SubscribeMessage('eventName')`. Nest subscribes the handler to incoming message packets matching that event name.

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  Ack,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'events' })
export class EventsGateway {
  /**
   * Basic Echo: Returns data directly as an acknowledgment response.
   */
  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: string): string {
    return data;
  }

  /**
   * Property Extraction: Extracts a single property from the incoming JSON payload.
   */
  @SubscribeMessage('orderStatus')
  handleOrderStatus(@MessageBody('orderId') orderId: string): string {
    return `Order ${orderId} is currently processing`;
  }

  /**
   * Accessing the Underlying Socket Instance.
   */
  @SubscribeMessage('identity')
  handleIdentity(
    @MessageBody() payload: { token: string },
    @ConnectedSocket() client: Socket,
  ): { clientId: string; address: string } {
    return {
      clientId: client.id,
      address: client.handshake.address,
    };
  }
}
```

### 3.1 Acknowledgment Callbacks: Implicit vs. Explicit (`@Ack()`)

In Socket.IO, client-emitted messages can attach an acknowledgment callback:

```javascript
// Client-side JavaScript
socket.emit('calculate', { a: 10, b: 20 }, (response) => {
  console.log('Result received from server:', response);
});
```

Nest supports two acknowledgment mechanisms:

1. **Implicit Acknowledgment**: Returning a value from the handler automatically executes the client's ACK callback with that value.
   - Returning `undefined` or `null` omits the response.
   - Other falsy values (`false`, `0`, `""`) are sent as valid responses.
2. **Explicit Acknowledgment with `@Ack()`**: Injects the acknowledgment callback directly into the method signature. When `@Ack()` is used, Nest disables implicit return acknowledgments:

```typescript
@SubscribeMessage('calculate')
handleCalculate(
  @MessageBody() data: { a: number; b: number },
  @Ack() ack: (response: { sum: number; status: string }) => void,
): void {
  const sum = data.a + data.b;
  // Explicitly dispatch the acknowledgment callback
  ack({ sum, status: 'ok' });
}
```

> [!NOTE]
> If a method emits directly through `client.emit('event', data)`, that emitted packet **bypasses interceptors**. Interceptors only observe values returned by the handler function.

---

## 4. Multiple and Asynchronous Responses

### 4.1 Returning `WsResponse<T>`

When a client does not use acknowledgment callbacks, or when communicating over native `ws` (which lacks request-response correlation), return a `WsResponse<T>` object containing an `event` name and payload `data`:

```typescript
import { SubscribeMessage, MessageBody, WsResponse } from '@nestjs/websockets';

@SubscribeMessage('query')
handleQuery(@MessageBody() filter: string): WsResponse<{ matchCount: number }> {
  return {
    event: 'queryResult',
    data: { matchCount: 42 },
  };
}
```

The client listens for the emitted event:

```javascript
socket.on('queryResult', (data) => console.log(data));
```

> [!WARNING]
> If your outgoing data relies on `ClassSerializerInterceptor` (e.g., stripping `@Exclude()` properties), return a class instance implementing `WsResponse`, because the interceptor ignores plain JavaScript object literals.

### 4.2 Streaming with RxJS Observables

Message handlers can return an `Observable`. Nest subscribes to the observable and emits each emitted value to the client until the stream completes:

```typescript
import { SubscribeMessage, MessageBody, WsResponse } from '@nestjs/websockets';
import { Observable, from, interval } from 'rxjs';
import { map, take } from 'rxjs/operators';

@SubscribeMessage('countdown')
handleCountdown(@MessageBody() seconds: number): Observable<WsResponse<number>> {
  return interval(1000).pipe(
    take(seconds),
    map((elapsed) => ({
      event: 'countdownTick',
      data: seconds - elapsed,
    })),
  );
}
```

---

## 5. Gateway Lifecycle Hooks

Gateways support three distinct lifecycle hooks representing server initialization, client connection, and client disconnection:

| Lifecycle Interface | Required Method | Parameter | Description |
| :--- | :--- | :--- | :--- |
| `OnGatewayInit` | `afterInit(server: any)` | Server instance | Executes once the native socket server is bound and ready. |
| `OnGatewayConnection` | `handleConnection(client: any, ...args: any[])` | Socket instance | Executes immediately when a client finishes the transport handshake. |
| `OnGatewayDisconnect` | `handleDisconnect(client: any)` | Socket instance | Executes when a client disconnects or times out. |

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'telemetry' })
export class TelemetryGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TelemetryGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server): void {
    this.logger.log(`Telemetry Gateway initialized on server engine: ${server.engine.opts}`);
  }

  handleConnection(client: Socket): void {
    const authHeader = client.handshake.headers.authorization;
    if (!authHeader) {
      this.logger.warn(`Unauthorized connection rejected: socket=${client.id}`);
      client.disconnect(true);
      return;
    }
    this.logger.log(`Client connected: socket=${client.id} remote=${client.handshake.address}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: socket=${client.id}`);
  }
}
```

---

## 6. Accessing the Native Server or Namespace

To broadcast events to rooms or namespaces from within services or the gateway itself, use the `@WebSocketServer()` decorator:

```typescript
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Namespace } from 'socket.io';

@WebSocketGateway({ namespace: 'orders' })
export class OrdersGateway {
  // Injects the Namespace instance because { namespace: 'orders' } was specified
  @WebSocketServer()
  ordersNamespace!: Namespace;

  notifyOrderDispatched(orderId: string, payload: unknown): void {
    this.ordersNamespace.to(`order:${orderId}`).emit('orderDispatched', payload);
  }
}
```

---

## 7. NestJS 12 Request-Scoped Gateways

Starting with **NestJS v12**, gateways support [request-scoped providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/02-injection-scopes.md). In WebSockets, the "request" scope is bound to the **lifetime of the connected socket connection**, rather than individual message packets.

Nest instantiates a dedicated instance of every `Scope.REQUEST` provider per connected socket. That instance persists across all message events received on that socket, safely maintaining per-connection state until the client disconnects.

### 7.1 Creating a Connection-Scoped Service

Inject the underlying socket instance using the core `REQUEST` token:

```typescript
// src/events/connection-state.service.ts
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Socket } from 'socket.io';

@Injectable({ scope: Scope.REQUEST })
export class ConnectionStateService {
  private messageSequence = 0;
  private readonly connectedAt = new Date();

  constructor(@Inject(REQUEST) private readonly client: Socket) {}

  incrementSequence(): { clientId: string; sequence: number; uptimeMs: number } {
    return {
      clientId: this.client.id,
      sequence: ++this.messageSequence,
      uptimeMs: Date.now() - this.connectedAt.getTime(),
    };
  }
}
```

### 7.2 Injecting into the Gateway

The gateway injects the request-scoped dependency like any standard provider:

```typescript
// src/events/stateful.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ConnectionStateService } from './connection-state.service.js';

@WebSocketGateway({ namespace: 'session' })
export class StatefulGateway implements OnGatewayConnection {
  constructor(private readonly connectionState: ConnectionStateService) {}

  handleConnection(client: Socket): void {
    client.emit('sessionInit', this.connectionState.incrementSequence());
  }

  @SubscribeMessage('ping')
  handlePing(): { event: string; data: unknown } {
    return {
      event: 'pong',
      data: this.connectionState.incrementSequence(),
    };
  }
}
```

> [!IMPORTANT]
> Because the scope is tied to the physical connection:
> - Client A calling `'ping'` multiple times increments Client A's internal sequence counter.
> - Client B receives its own isolated `ConnectionStateService` instance with its own zero-initialized counter.
> - When the socket disconnects, Nest garbage collects the request-scoped service instances.
> - Avoid using `Scope.REQUEST` unless per-connection state is strictly required, as it introduces per-socket memory overhead.

---

## 8. Complete Production Gateway Example

The following production-ready gateway demonstrates namespaces, authentication in connection hooks, rooms, typed payloads, explicit acknowledgments, and server broadcasts:

```typescript
// src/notifications/notifications.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  Ack,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

interface JoinRoomDto {
  roomName: string;
}

interface MessagePayloadDto {
  roomName: string;
  content: string;
}

@WebSocketGateway(8081, {
  namespace: 'notifications',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    const userId = client.handshake.query.userId as string;
    if (!userId) {
      this.logger.warn(`Rejected connection without userId: ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    this.logger.log(`User ${userId} connected via socket ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket disconnected: ${client.id} (user: ${client.data.userId})`);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() payload: JoinRoomDto,
    @ConnectedSocket() client: Socket,
    @Ack() ack: (res: { joined: boolean; room: string }) => void,
  ): void {
    client.join(payload.roomName);
    this.logger.log(`Socket ${client.id} joined room ${payload.roomName}`);
    ack({ joined: true, room: payload.roomName });
  }

  @SubscribeMessage('sendToRoom')
  handleSendToRoom(
    @MessageBody() payload: MessagePayloadDto,
    @ConnectedSocket() client: Socket,
  ): void {
    // Broadcast to all clients in the room excluding the sender
    client.to(payload.roomName).emit('roomMessage', {
      senderId: client.data.userId,
      content: payload.content,
      timestamp: new Date().toISOString(),
    });
  }
}
```

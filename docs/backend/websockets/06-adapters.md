# WebSockets: Adapters

> **Source**: https://docs.nestjs.com/websockets/adapter  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The NestJS WebSockets module is completely transport-agnostic. While Socket.IO and the native `ws` library are supported out of the box, Nest relies on the **Adapter Pattern** via the `WebSocketAdapter` interface to decouple gateway business logic from the underlying network protocol and socket runtime.

---

## 1. The `WebSocketAdapter` Interface

Any custom or extended WebSocket server implementation must implement the `WebSocketAdapter` interface:

| Method | Signature | Responsibility |
| :--- | :--- | :--- |
| `create` | `create(port: number, options?: any): any` | Instantiates and returns the underlying native socket server instance. |
| `bindClientConnect` | `bindClientConnect(server: any, callback: Function): void` | Binds the connection event listener when a new client connects. |
| `bindClientDisconnect` | `bindClientDisconnect?(server: any, callback: Function): void` | Binds the disconnection event listener when a client disconnects. |
| `bindMessageHandlers` | `bindMessageHandlers(client: any, handlers: MessageMappingProperties[], process: Function): void` | Maps incoming message packets to gateway `@SubscribeMessage()` handlers. |
| `close` | `close(server: any): void` | Closes and terminates the socket server during application shutdown. |

---

## 2. Scaling Socket.IO Horizontally with Redis (`IoAdapter`)

When deploying multiple load-balanced instances of a NestJS service (e.g., Kubernetes replicas or container instances behind an Application Load Balancer), client sockets connected to Pod A cannot receive broadcasts emitted by Pod B.

To broadcast events and share rooms across all distributed nodes, extend `IoAdapter` and attach the `@socket.io/redis-adapter`.

### 2.1 The Sticky Session & Transport Constraint

> [!WARNING]
> **Sticky Sessions Requirement**:
> To run Socket.IO across multiple load-balanced instances, you **must**:
> 1. Disable HTTP long-polling and enforce strictly WebSocket transport: `transports: ['websocket']` in both server and client configurations; **OR**
> 2. Enable cookie-based routing (sticky sessions) on your load balancer (e.g., AWS ALB, Nginx `ip_hash` / cookie stickiness).
> 
> Redis alone is **not sufficient** to resolve multi-node handshake failures if clients fall back to HTTP long-polling across unpinned nodes.

### 2.2 Installing Clustering Dependencies

```bash
pnpm add redis socket.io @socket.io/redis-adapter
```

### 2.3 Creating the `RedisIoAdapter`

```typescript
// src/common/adapters/redis-io.adapter.ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379',
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = createClient({ url: this.redisUrl });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => this.logger.error('Redis Pub Client Error', err));
    subClient.on('error', (err) => this.logger.error('Redis Sub Client Error', err));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(`Connected to Redis Pub/Sub cluster at ${this.redisUrl}`);
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const serverOptions: ServerOptions = {
      ...options,
      // Enforce websocket-only transport to bypass sticky session requirements
      transports: ['websocket'],
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    };

    const server = super.createIOServer(port, serverOptions);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
```

### 2.4 Registering the Adapter in `main.ts`

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  // Attach custom adapter globally
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(3000);
}
void bootstrap();
```

---

## 3. High-Throughput Native WebSockets (`WsAdapter`)

The `WsAdapter` acts as a direct proxy between NestJS and the ultra-fast, RFC 6455-compliant [ws](https://github.com/websockets/ws) library. It offers significantly higher throughput and lower memory footprint per socket than Socket.IO, but omits higher-level features such as namespaces and rooms.

### 3.1 Installation & Activation

```bash
pnpm add @nestjs/platform-ws ws
pnpm add -D @types/ws
```

Activate the adapter in `main.ts`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new WsAdapter(app));

  await app.listen(3000);
}
void bootstrap();
```

### 3.2 Namespaces vs. Distinct Paths

> [!CAUTION]
> The native `ws` library **does not support namespaces**. Setting the `namespace` property inside `@WebSocketGateway({ namespace: 'events' })` will throw a runtime error when using `WsAdapter`.
> 
> To isolate distinct message streams with `WsAdapter`, mount gateways on separate URL paths:

```typescript
// Mounts on ws://localhost:3000/orders
@WebSocketGateway({ path: '/orders' })
export class OrdersGateway {}

// Mounts on ws://localhost:3000/chat
@WebSocketGateway({ path: '/chat' })
export class ChatGateway {}
```

### 3.3 Custom Message Parsers

By default, `WsAdapter` expects messages formatted as JSON objects: `{ "event": "eventName", "data": ... }`.

To support alternative message protocols (such as array tuples `["event", payload]` or binary frames), supply a custom `messageParser`:

```typescript
const wsAdapter = new WsAdapter(app, {
  messageParser: (rawData) => {
    // Parse tuple format: ["eventName", { ...payload }]
    const [event, data] = JSON.parse(rawData.toString());
    return { event, data };
  },
});

app.useWebSocketAdapter(wsAdapter);
```

---

## 4. Advanced: Authoring a Custom Adapter from Scratch

To demonstrate how the abstraction operates internally, the following example builds a minimal native `ws` adapter utilizing RxJS streams for message mapping:

```typescript
// src/common/adapters/custom-ws.adapter.ts
import WebSocket, { WebSocketServer } from 'ws';
import { WebSocketAdapter, INestApplicationContext, Logger } from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import { Observable, fromEvent, EMPTY } from 'rxjs';
import { mergeMap, filter } from 'rxjs/operators';

export class CustomWsAdapter implements WebSocketAdapter {
  private readonly logger = new Logger(CustomWsAdapter.name);

  constructor(private readonly app: INestApplicationContext) {}

  create(port: number, options: any = {}): WebSocketServer {
    this.logger.log(`Instantiating WebSocket.Server on port ${port || 'HTTP multiplex'}`);
    return new WebSocketServer({ port, ...options });
  }

  bindClientConnect(server: WebSocketServer, callback: (socket: WebSocket) => void): void {
    server.on('connection', callback);
  }

  bindClientDisconnect(client: WebSocket, callback: () => void): void {
    client.on('close', callback);
  }

  bindMessageHandlers(
    client: WebSocket,
    handlers: MessageMappingProperties[],
    process: (data: any) => Observable<any>,
  ): void {
    fromEvent(client, 'message')
      .pipe(
        mergeMap((event: any) => this.bindMessageHandler(event, handlers, process)),
        filter((result) => result !== undefined && result !== null),
      )
      .subscribe((response) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(response));
        }
      });
  }

  private bindMessageHandler(
    buffer: { data: any },
    handlers: MessageMappingProperties[],
    process: (data: any) => Observable<any>,
  ): Observable<any> {
    try {
      const rawText = buffer.data.toString();
      const message = JSON.parse(rawText);

      // Find the @SubscribeMessage handler matching the incoming message event
      const messageHandler = handlers.find((handler) => handler.message === message.event);
      if (!messageHandler) {
        return EMPTY;
      }

      // Delegate callback execution to Nest's process wrapper
      return process(messageHandler.callback(message.data));
    } catch (err) {
      this.logger.error('Failed to parse incoming WebSocket frame', err);
      return EMPTY;
    }
  }

  close(server: WebSocketServer): void {
    server.close();
  }
}
```

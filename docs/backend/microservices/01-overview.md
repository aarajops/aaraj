# Microservices: Overview & Foundations

> **Source**: https://docs.nestjs.com/microservices/basics  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Nest natively supports the microservice architectural style of development. In Nest, a **microservice** is fundamentally an application that swaps the HTTP transport layer for an asynchronous messaging protocol, an RPC communication channel, or an enterprise event bus.

Nest abstracts the technical implementation details of each transport layer behind a canonical interface for two primary message styles:
1. **Request-Response Messaging**: Two-way synchronous-like communication where a client sends a message and awaits an acknowledged response.
2. **Event-Driven Messaging**: One-way asynchronous publishing where an event is broadcast to one or more subscribers without blocking or waiting for a reply.

---

## 1. Installation & Transporter Abstraction

To start building microservices, install the core microservices package:

```bash
pnpm add @nestjs/microservices
```

Nest provides several built-in transport layer implementations, called **transporters**, managed through the `Transport` enum:

```typescript
import { Transport } from '@nestjs/microservices';

// Available transporters:
// Transport.TCP (Default)
// Transport.REDIS
// Transport.MQTT
// Transport.NATS
// Transport.RMQ (RabbitMQ)
// Transport.KAFKA
// Transport.GRPC
```

---

## 2. Bootstrapping a Microservice

To instantiate a standalone microservice application, use `NestFactory.createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: '127.0.0.1',
        port: 8877,
        retryAttempts: 5,
        retryDelay: 3000,
        // Drop silent peers after 30 seconds
        incompleteMessageTimeout: 30000,
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

### 2.1 TCP Transporter Options Reference

The TCP transporter runs over raw Node.js TCP sockets:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `host` | `string` | `'127.0.0.1'` | Connection hostname or IP. |
| `port` | `number` | `3000` | Connection port. |
| `retryAttempts` | `number` | `0` | Number of reconnection attempts after unexpected disconnection. |
| `retryDelay` | `number` | `0` | Delay between retry attempts in milliseconds. |
| `serializer` | `Serializer` | Built-in | Custom serializer for outgoing message packets. |
| `deserializer` | `Deserializer` | Built-in | Custom deserializer for incoming message packets. |
| `socketClass` | `Type<TcpSocket>`| `JsonSocket` | Custom socket implementation. |
| `tlsOptions` | `TlsOptions` | `undefined` | TLS encryption certificates and options. |
| `maxBufferSize` | `number` | `128 MB` | Maximum buffer size for incoming messages. |
| `incompleteMessageTimeout` | `number` | `30000` | Timeout in ms before dropping peers who hang mid-packet (`0` to disable). |
| `maxSendBufferSize` | `number` | `128 MB` | Max bytes queued for slow readers before connection teardown. |

---

## 3. Message and Event Patterns

Microservices route messages by matching **patterns**. A pattern is a plain value: either a string (e.g., `'orders.created'`) or a literal object (e.g., `{ cmd: 'calculate_tax' }`). Patterns are serialized and transmitted over the wire alongside the message payload.

### 3.1 Request-Response (`@MessagePattern()`)

The request-response style exchanges data synchronously from the caller's perspective:

```typescript
// src/math/math.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Ctx } from '@nestjs/microservices';
import { TcpContext } from '@nestjs/microservices';

@Controller()
export class MathController {
  @MessagePattern({ cmd: 'accumulate' })
  accumulate(
    @Payload() data: number[],
    @Ctx() context: TcpContext,
  ): number {
    const socket = context.getSocketRef();
    return (data || []).reduce((a, b) => a + b, 0);
  }
}
```

> [!IMPORTANT]
> The `@MessagePattern()` and `@EventPattern()` decorators can **only be used within Controller classes**. The Nest runtime ignores them if placed on service providers.

#### Asynchronous & Streaming Responses

Handlers can return a `Promise` or an RxJS `Observable`:

```typescript
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

@MessagePattern({ cmd: 'stream_range' })
streamRange(@Payload() count: number): Observable<number> {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  return from(numbers);
}
```

### 3.2 Event-Based (`@EventPattern()`)

When an operation does not require a response (e.g., audit logging, email dispatch, metrics emission), use `@EventPattern()`. Event messages use a single channel and avoid response-waiting overhead:

```typescript
// src/users/users.controller.ts
import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

@Controller()
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  @EventPattern('user.registered')
  async handleUserRegistered(@Payload() data: { userId: string; email: string }): Promise<void> {
    this.logger.log(`Received user.registered event for user: ${data.userId}`);
    // Execute asynchronous domain side effects
  }
}
```

> [!NOTE]
> You can register multiple event handlers for a **single event pattern**. Nest executes all matching handlers concurrently in parallel.

---

## 4. Client Proxies (Publishing & Sending)

Client applications exchange messages with remote microservices using the `ClientProxy` abstraction.

### 4.1 Module Registration (`ClientsModule`)

The recommended pattern registers clients in a module using `ClientsModule.register()`:

```typescript
// src/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BillingService } from './billing.service.js';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'MATH_PACKAGE',
        transport: Transport.TCP,
        options: {
          host: '127.0.0.1',
          port: 8877,
        },
      },
    ]),
  ],
  providers: [BillingService],
})
export class BillingModule {}
```

#### Dynamic Asynchronous Configuration (`registerAsync`)

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config';

ClientsModule.registerAsync([
  {
    name: 'ORDER_SERVICE',
    imports: [ConfigModule],
    useFactory: (config: ConfigService) => ({
      transport: Transport.TCP,
      options: {
        host: config.get<string>('ORDER_SVC_HOST', '127.0.0.1'),
        port: config.get<number>('ORDER_SVC_PORT', 8888),
      },
    }),
    inject: [ConfigService],
  },
])
```

### 4.2 Injecting and Using `ClientProxy`

Inject the client using the `@Inject()` decorator with the configured registration token:

```typescript
// src/billing/billing.service.ts
import { Injectable, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';

@Injectable()
export class BillingService implements OnApplicationBootstrap {
  constructor(
    @Inject('MATH_PACKAGE') private readonly mathClient: ClientProxy,
  ) {}

  /**
   * ClientProxy is lazy by default. Pre-connect during bootstrap
   * to verify broker availability before accepting HTTP traffic.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.mathClient.connect();
  }

  calculateTotal(items: number[]): Observable<number> {
    const pattern = { cmd: 'accumulate' };
    // send() returns a cold Observable (executes only upon subscription)
    return this.mathClient
      .send<number, number[]>(pattern, items)
      .pipe(timeout(5000));
  }

  notifyInvoiceGenerated(invoiceId: string): void {
    // emit() returns a hot Observable (dispatched immediately)
    this.mathClient.emit('invoice.generated', { invoiceId, createdAt: new Date() });
  }
}
```

---

## 5. Request-Scoped Microservice Handlers

While most Nest services are singletons, microservice message handlers support `Scope.REQUEST` for multi-tenancy, per-message caching, or request tracking.

Inject `RequestContext` using the `CONTEXT` token:

```typescript
// src/orders/orders.service.ts
import { Injectable, Scope, Inject } from '@nestjs/common';
import { CONTEXT, RequestContext } from '@nestjs/microservices';

@Injectable({ scope: Scope.REQUEST })
export class TenantOrderService {
  constructor(
    @Inject(CONTEXT) private readonly requestContext: RequestContext,
  ) {}

  process(): string {
    const pattern = this.requestContext.getPattern();
    const data = this.requestContext.getData();
    return `Processed pattern ${JSON.stringify(pattern)} with payload: ${JSON.stringify(data)}`;
  }
}
```

---

## 6. Connection Telemetry, Status & Driver Access

### 6.1 Status Streams & Lifecycle Events

Both microservice servers and client proxies expose an observable `status` stream emitting connection lifecycle states:

```typescript
import { TcpStatus } from '@nestjs/microservices';

// Observe Client connection status
this.mathClient.status.subscribe((status: TcpStatus) => {
  console.log(`TCP Client Status: ${status}`); // 'connected' | 'disconnected'
});

// Listen to raw transport errors
this.mathClient.on('error', (err) => {
  console.error('Client transport error:', err);
});
```

### 6.2 Accessing the Underlying Driver (`unwrap`)

If you must access the low-level transport engine (such as Node's `net.Server`):

```typescript
import { Server } from 'node:net';

// Client native driver
const netSocket = this.mathClient.unwrap();

// Server native driver
const netServer = app.unwrap<Server>();
```

---

## 7. Transport Layer Security (TLS)

For point-to-point TCP communication outside a private perimeter, encrypt socket traffic using Node's TLS module:

### 7.1 Server TLS Configuration

```typescript
import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: '0.0.0.0',
        port: 8877,
        tlsOptions: {
          key: fs.readFileSync('./certs/server-key.pem', 'utf8'),
          cert: fs.readFileSync('./certs/server-cert.pem', 'utf8'),
        },
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

### 7.2 Client TLS Configuration

```typescript
ClientsModule.register([
  {
    name: 'SECURE_MATH_SERVICE',
    transport: Transport.TCP,
    options: {
      host: 'secure-node.internal',
      port: 8877,
      tlsOptions: {
        ca: [fs.readFileSync('./certs/ca-cert.pem', 'utf8')],
      },
    },
  },
])
```

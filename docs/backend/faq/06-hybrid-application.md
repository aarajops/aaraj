# Hybrid Applications & Multi-Transporter Architectures

> **Domain**: Polyglot Transport Ingress, Event Mesh & Microservice Bridging  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

A **Hybrid Application** in NestJS is a single deployable service that concurrently listens on an HTTP server while acting as a listener on one or more [Microservice Transporters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/01-overview.md) (such as TCP, Redis, NATS, RabbitMQ, or Kafka).

This pattern is ideal for services that provide external REST/GraphQL APIs while simultaneously consuming internal asynchronous events from a message bus.

```text
                               HYBRID APPLICATION
                                        │
           ┌────────────────────────────┴────────────────────────────┐
           ▼                                                         ▼
┌───────────────────────┐                                 ┌───────────────────────┐
│     HTTP Ingress      │                                 │ Microservice Transports│
├───────────────────────┤                                 ├───────────────────────┤
│ • Express / Fastify   │                                 │ • NATS JetStream      │
│ • Port 3000           │                                 │ • Redis Pub/Sub       │
│ • REST / GraphQL API  │                                 │ • RabbitMQ / Kafka    │
└───────────────────────┘                                 └───────────────────────┘
```

---

## 1. Connecting Transporters to an HTTP Application

Use `app.connectMicroservice()` on the `INestApplication` instance in `src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Connect TCP Microservice listener
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      port: 3001,
    },
  });

  // 2. Connect Redis event queue listener
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: 6379,
    },
  });

  // Critical startup sequence: init HTTP app BEFORE consuming microservice events
  await app.listen(3000);
  await app.startAllMicroservices();

  console.log('Hybrid Application is accepting HTTP on 3000 and listening to message brokers');
}
await bootstrap();
```

---

## 2. Startup Execution Order & Lifecycle Hooks

> **Caution**: The sequence in which you call `app.listen()` and `app.startAllMicroservices()` dictates message consumption timing:

1. **Incorrect (Pre-Mature Consumption)**:
   ```typescript
   await app.startAllMicroservices();
   await app.listen(3000);
   ```
   If `startAllMicroservices()` is called first, brokers immediately dispatch messages to handlers **before** the application's lifecycle hooks (`onModuleInit` and `onApplicationBootstrap`) finish. If a handler relies on a database connection established in `onModuleInit`, unhandled exceptions will occur.

2. **Correct (Deterministic Initialization)**:
   ```typescript
   await app.listen(3000); // Or await app.init() if purely non-HTTP
   await app.startAllMicroservices();
   ```
   Ensures the entire dependency graph, database pools, and caching layers are completely warmed up before events are dequeued.

---

## 3. Multiplexing Patterns by Transporter

When multiple microservices are connected to the same hybrid application, handlers can bind to specific transports using the second argument of `@MessagePattern()` or `@EventPattern()`:

```typescript
import { Controller } from '@nestjs/common';
import {
  MessagePattern,
  Payload,
  Ctx,
  Transport,
  type NatsContext,
} from '@nestjs/microservices';

@Controller()
export class HybridEventsController {
  // Handled ONLY when received via NATS
  @MessagePattern('orders.created', Transport.NATS)
  handleNatsOrder(@Payload() orderId: string, @Ctx() context: NatsContext) {
    console.log(`NATS Subject: ${context.getSubject()}, Order: ${orderId}`);
    return { status: 'processed_via_nats' };
  }

  // Handled ONLY when received via TCP
  @MessagePattern({ cmd: 'calculate_tax' }, Transport.TCP)
  calculateTax(@Payload() amount: number) {
    return { tax: amount * 0.2 };
  }
}
```

---

## 4. Configuration Sharing (`inheritAppConfig`)

By default, connected microservices do **not** inherit global pipes, interceptors, guards, and filters bound to the HTTP application. To enforce uniform validation and security policies across all transports, set `inheritAppConfig: true`:

```typescript
const microservice = app.connectMicroservice<MicroserviceOptions>(
  {
    transport: Transport.TCP,
    options: { port: 3001 },
  },
  {
    inheritAppConfig: true, // Propagates global pipes, guards, filters, interceptors
  },
);
```

> **Rule**: When using `inheritAppConfig: true`, all `app.useGlobalPipes()`, `app.useGlobalGuards()`, and `app.useGlobalFilters()` calls **must precede** the `app.connectMicroservice()` call. Otherwise, handlers registered during connection will miss the global enhancers.

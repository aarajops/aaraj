# Microservices: NATS Transporter

> **Source**: https://docs.nestjs.com/microservices/nats  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@nats-io/transport-node`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[NATS](https://nats.io) is a simple, secure, high-performance messaging system designed for cloud-native microservices, multi-region meshes, and edge computing.

---

## 1. Installation & NestJS v12 NATS v3 Driver

> [!WARNING]
> **NestJS v12 Breaking Change**:
> Starting with **NestJS v12**, the NATS transporter targets **NATS v3** and uses the modern `@nats-io/transport-node` driver. If upgrading from legacy versions, uninstall the old `nats` package and install the official v3 package:

```bash
pnpm remove nats
pnpm add @nats-io/transport-node @nats-io/nats-core
```

---

## 2. Server Configuration & Queue Groups

Configure the NATS microservice in `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.NATS,
      options: {
        servers: [process.env.NATS_URL || 'nats://localhost:4222'],
        // Distributed Queue Group: Load balances messages across multiple replicas
        queue: 'orders_processing_group',
        gracefulShutdown: true,
        gracePeriod: 10000, // Wait 10s after unsubscribing before teardown
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

### 2.1 Queue Groups Architecture

In NATS, standard subscriptions broadcast every message to every listening subscriber (fan-out). Setting the `queue` property registers the microservice into a **Distributed Queue Group**: NATS automatically load-balances incoming subject messages across members of the queue group so that each packet is processed by **exactly one service replica**.

---

## 3. Patterns, Wildcards & Context

```typescript
// src/events/events.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { NatsContext } from '@nestjs/microservices';

@Controller()
export class EventsController {
  /**
   * Request-Response Pattern:
   * Uses NATS inbox reply subjects for dynamic routing.
   */
  @MessagePattern('users.getById')
  getUser(@Payload() id: string, @Ctx() context: NatsContext): { id: string; name: string } {
    console.log(`Received request on subject: ${context.getSubject()}`);
    return { id, name: 'Alice' };
  }

  /**
   * Subject Wildcards:
   * Matches 'orders.us.created', 'orders.eu.created'
   */
  @EventPattern('orders.*.created')
  handleOrderCreated(
    @Payload() orderData: unknown,
    @Ctx() context: NatsContext,
  ): void {
    const headers = context.getHeaders();
    console.log(`Trace ID: ${headers?.get('x-trace-id')}`);
  }
}
```

---

## 4. Record Builders & Headers

To attach metadata and custom headers to NATS messages, use `NatsRecordBuilder`:

```typescript
// src/events/events.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import { headers } from '@nats-io/nats-core';

@Injectable()
export class EventsService {
  constructor(
    @Inject('NATS_CLIENT') private readonly client: ClientProxy,
  ) {}

  dispatchOrder(order: Record<string, unknown>): void {
    const natsHeaders = headers();
    natsHeaders.set('x-version', '1.0.0');
    natsHeaders.set('x-correlation-id', 'req_abc123');

    const record = new NatsRecordBuilder(order)
      .setHeaders(natsHeaders)
      .build();

    this.client.emit('orders.us.created', record);
  }
}
```

---

## 5. NestJS v12 Custom Deserializers

In NestJS v12, NATS payloads are serialized as JSON strings. Custom deserializers receive the full NATS message object directly, and payloads should be parsed via `msg.json()`:

```typescript
// src/common/deserializers/custom-nats.deserializer.ts
import { Deserializer, IncomingRequest } from '@nestjs/microservices';

export class CustomNatsDeserializer implements Deserializer {
  deserialize(msg: any): IncomingRequest {
    // Read parsed JSON payload directly from the NATS message object
    return msg.json();
  }
}
```

---

## 6. Driver Telemetry & Low-Level Access

```typescript
import { NatsStatus, NatsEvents } from '@nestjs/microservices';
import type { NatsConnection } from '@nats-io/transport-node';

// Lifecycle status stream: 'connected' | 'disconnected' | 'reconnecting'
this.client.status.subscribe((status: NatsStatus) => {
  console.log(`NATS Connection Status: ${status}`);
});

// Cluster topology & disconnect events:
this.client.on('disconnect', (serverUrl) => {
  console.warn(`Disconnected from NATS cluster node: ${serverUrl}`);
});

// Access the underlying NATS v3 connection
const natsConnection = this.client.unwrap<NatsConnection>();
```

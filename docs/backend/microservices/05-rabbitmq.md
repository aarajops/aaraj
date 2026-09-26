# Microservices: RabbitMQ Transporter

> **Source**: https://docs.nestjs.com/microservices/rabbitmq  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `amqplib`, `amqp-connection-manager`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[RabbitMQ](https://www.rabbitmq.com/) is an enterprise-grade message broker built on the AMQP 0-9-1 standard, supporting complex exchange routing, durable queues, manual consumer acknowledgments, and high-availability clustering.

---

## 1. Installation & Driver Setup

To build RabbitMQ microservices, install the underlying AMQP connection manager and library:

```bash
pnpm add amqplib amqp-connection-manager
pnpm add -D @types/amqplib
```

---

## 2. Server Configuration

Pass `Transport.RMQ` and queue options to `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: 'orders_queue',
        // Manual message acknowledgment mode
        noAck: false,
        prefetchCount: 10,
        isGlobalPrefetchCount: false,
        queueOptions: {
          durable: true,
        },
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

---

## 3. Manual Message Acknowledgments (`noAck: false`)

In mission-critical distributed architectures, messages must not be lost if a consumer node crashes mid-execution.

When `noAck: false` is configured, your handler must explicitly invoke `channel.ack()` once the message has been durably processed:

```typescript
// src/orders/orders.controller.ts
import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx } from '@nestjs/microservices';
import { RmqContext } from '@nestjs/microservices';

@Controller()
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  @MessagePattern('order.process')
  async processOrder(
    @Payload() order: { id: string; amount: number },
    @Ctx() context: RmqContext,
  ): Promise<{ status: string }> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      this.logger.log(`Processing order: ${order.id}`);
      // Perform database transactions and state updates...

      // Acknowledge receipt to delete message from queue
      channel.ack(originalMsg);
      return { status: 'completed' };
    } catch (error) {
      this.logger.error(`Failed processing order ${order.id}:`, error);

      // Requeue message or route to dead-letter exchange
      channel.nack(originalMsg, false, true);
      throw error;
    }
  }
}
```

---

## 4. Topic Exchanges & Routing Key Wildcards

To route messages using AMQP Topic Exchanges, set `wildcards: true`:
- `*`: Matches exactly one word.
- `#`: Matches zero or more words.

```typescript
// Transporter configuration with Topic Exchange
const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://localhost:5672'],
    queue: 'inventory_queue',
    wildcards: true,
    exchange: 'inventory_exchange',
    exchangeType: 'topic',
  },
});
```

Subscribe to wildcard routing patterns:

```typescript
@MessagePattern('inventory.items.#')
handleInventoryUpdate(@Payload() data: unknown, @Ctx() context: RmqContext) {
  console.log(`Matched routing key: ${context.getPattern()}`);
}
```

---

## 5. Record Builders & Priority Queues

Use `RmqRecordBuilder` to define message headers, expiration, or priority levels:

```typescript
// src/orders/orders.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';

@Injectable()
export class OrdersService {
  constructor(
    @Inject('RMQ_CLIENT') private readonly client: ClientProxy,
  ) {}

  dispatchUrgentOrder(order: unknown): void {
    const record = new RmqRecordBuilder(order)
      .setOptions({
        priority: 10,
        headers: {
          'x-trace-id': 'trc_123',
        },
      })
      .build();

    this.client.send('order.process', record).subscribe();
  }
}
```

---

## 6. Driver Telemetry & Low-Level Access

```typescript
import { RmqStatus } from '@nestjs/microservices';
import type { AmqpConnectionManager } from 'amqp-connection-manager';

// Status stream emits: 'connected' | 'disconnected' | 'blocked' | 'unblocked'
this.client.status.subscribe((status: RmqStatus) => {
  console.log(`RabbitMQ connection state: ${status}`);
});

// Access the underlying AMQP connection manager
const manager = this.client.unwrap<AmqpConnectionManager>();
```

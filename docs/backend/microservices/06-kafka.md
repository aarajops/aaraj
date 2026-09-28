# Microservices: Kafka Transporter

> **Source**: https://docs.nestjs.com/microservices/kafka  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `kafkajs`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Apache Kafka](https://kafka.apache.org/) is a distributed, horizontally scalable, fault-tolerant event streaming platform. Unlike traditional ephemeral message queues, Kafka persists records in immutable, partitioned commit logs, making it ideal for event sourcing, telemetry pipelines, and high-throughput microservices.

---

## 1. Installation & Driver Setup

The Kafka transporter uses the [KafkaJS](https://kafka.js.org/) client:

```bash
pnpm add kafkajs
```

---

## 2. Server Configuration & Architecture

Pass `Transport.KAFKA` and connection options to `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'billing-service',
          brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
        },
        consumer: {
          groupId: 'billing-consumer-group',
        },
        run: {
          // Disable auto-commit when manual offset management is required
          autoCommit: false,
        },
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

---

## 3. Regular Expression Patterns (NestJS v12)

Starting with **NestJS v12**, you can pass a `RegExp` directly to `@MessagePattern()` or `@EventPattern()`. Nest forwards the regular expression to KafkaJS's topic subscription API:

```typescript
// src/orders/orders.controller.ts
import { Controller } from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { KafkaContext } from '@nestjs/microservices';

@Controller()
export class OrdersController {
  /**
   * RegExp Pattern Subscription:
   * Subscribes dynamically to 'orders.us.created', 'orders.eu.created', etc.
   */
  @EventPattern(/^orders\..+\.created$/)
  handleRegionalOrder(
    @Payload() order: unknown,
    @Ctx() context: KafkaContext,
  ): void {
    console.log(`Received order from topic: ${context.getTopic()}`);
    console.log(`Partition: ${context.getPartition()}`);
  }
}
```

---

## 4. Request-Response Mechanics & Reply Partitions

When implementing request-response via `ClientKafkaProxy.send()`, Nest derives a reply topic (by default `<request-topic>.reply`) and tracks correlation IDs.

> [!WARNING]
> **Partition Allocation Rule**:
> Each running NestJS instance must be assigned **at least one reply topic partition**. If you deploy 4 replicas of a service, the reply topic must have at least 4 partitions; otherwise, instances without an assigned partition will fail to receive response messages.

```typescript
// src/billing/billing.service.ts
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @Inject('KAFKA_CLIENT') private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    // Explicitly subscribe to response topic before connecting
    this.kafkaClient.subscribeToResponseOf('orders.calculateTax');
    await this.kafkaClient.connect();
  }

  calculateTax(orderId: string): Observable<number> {
    return this.kafkaClient.send('orders.calculateTax', { orderId });
  }
}
```

---

## 5. Keyed Messages & Co-Partitioning

To guarantee that messages relating to the same entity (e.g., `userId` or `orderId`) land on the exact same partition (enforcing strictly ordered processing), specify a message `key`:

```typescript
@MessagePattern('orders.create')
createOrder(@Payload() order: { orderId: string; amount: number }) {
  return {
    key: order.orderId, // Partitioning key
    value: { ...order, status: 'CONFIRMED' },
    headers: {
      'x-source': 'aaraj-api',
    },
  };
}
```

---

## 6. Manual Offset Commits & Heartbeats

For long-running tasks, send periodic heartbeats to prevent Kafka from triggering a consumer rebalance, and commit offsets manually:

```typescript
@EventPattern('video.transcode')
async transcodeVideo(
  @Payload() videoData: { id: string },
  @Ctx() context: KafkaContext,
): Promise<void> {
  const heartbeat = context.getHeartbeat();
  const consumer = context.getConsumer();
  const { offset } = context.getMessage();
  const partition = context.getPartition();
  const topic = context.getTopic();

  // Step 1: Heavy CPU processing
  await performInitialWork();
  await heartbeat(); // Reset session timeout

  // Step 2: Finalize transcoding
  await finalizeTranscoding();

  // Step 3: Commit next offset (current + 1)
  await consumer.commitOffsets([
    { topic, partition, offset: (Number(offset) + 1).toString() },
  ]);
}
```

---

## 7. Retries & `KafkaRetriableException`

Unhandled exceptions in event handlers are treated as retriable by default (the offset is not committed). For message handlers, throw `KafkaRetriableException`:

```typescript
import { KafkaRetriableException } from '@nestjs/microservices';

@MessagePattern('inventory.reserve')
reserveStock(@Payload() item: { id: string }) {
  if (!isDatabaseReady()) {
    throw new KafkaRetriableException('Temporary database unavailability');
  }
}
```

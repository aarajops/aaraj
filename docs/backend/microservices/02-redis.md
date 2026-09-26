# Microservices: Redis Transporter

> **Source**: https://docs.nestjs.com/microservices/redis  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `ioredis`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The Redis transporter implements the publish/subscribe messaging paradigm via Redis [Pub/Sub](https://redis.io/topics/pubsub). Messages are published to named channels without publishers knowing which subscribers exist.

Because Redis Pub/Sub is inherently **fire-and-forget**, if no subscriber is active on a channel when a message is published, the message is discarded. It does not provide log retention or acknowledgment guarantees like Kafka or RabbitMQ, making it ideal for high-throughput, low-latency, ephemeral event notifications and cache synchronization.

---

## 1. Installation & Driver Setup

The Redis transporter requires the official, high-performance [ioredis](https://github.com/redis/ioredis) client:

```bash
pnpm add ioredis
pnpm add -D @types/ioredis
```

---

## 2. Server Configuration

Pass `Transport.REDIS` and connection options to `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD,
        retryAttempts: 5,
        retryDelay: 3000,
        // Enables psubscribe / pmessage pattern matching
        wildcards: true,
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

### 2.1 Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `host` | `string` | `'localhost'` | Redis server hostname. |
| `port` | `number` | `6379` | Redis server port. |
| `retryAttempts` | `number` | `0` | Number of reconnection attempts. |
| `retryDelay` | `number` | `5000` | Delay between retry attempts in milliseconds. |
| `wildcards` | `boolean` | `false` | Enables pattern subscriptions (`psubscribe` / `pmessage`). |

All standard `ioredis` configuration properties (e.g., `tls`, `sentinels`, `db`, `keyPrefix`) are directly supported in the `options` object.

---

## 3. Subscriptions & Pattern Matching

### 3.1 Channel Pattern Handling

```typescript
// src/notifications/notifications.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { RedisContext } from '@nestjs/microservices';

@Controller()
export class NotificationsController {
  @MessagePattern('cache.invalidate')
  handleInvalidate(
    @Payload() key: string,
    @Ctx() context: RedisContext,
  ): { status: string } {
    console.log(`Received command on channel: ${context.getChannel()}`);
    return { status: `Key ${key} cleared` };
  }

  /**
   * Channel Wildcards: Requires `wildcards: true` in transporter options.
   * Matches 'system.alerts.cpu', 'system.alerts.memory', etc.
   */
  @EventPattern('system.alerts.*')
  handleAlert(
    @Payload() alert: { level: string; message: string },
    @Ctx() context: RedisContext,
  ): void {
    console.log(`Alert received on channel ${context.getChannel()}: ${alert.message}`);
  }
}
```

---

## 4. Client Producer Configuration

Register the Redis client in a module via `ClientsModule.register()`:

```typescript
// src/telemetry/telemetry.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TelemetryService } from './telemetry.service.js';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'REDIS_TRANSPORTER',
        transport: Transport.REDIS,
        options: {
          host: '127.0.0.1',
          port: 6379,
          wildcards: true,
        },
      },
    ]),
  ],
  providers: [TelemetryService],
})
export class TelemetryModule {}
```

### 4.1 Publishing Messages & Events

```typescript
// src/telemetry/telemetry.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Injectable()
export class TelemetryService {
  constructor(
    @Inject('REDIS_TRANSPORTER') private readonly client: ClientProxy,
  ) {}

  // Request-Response (creates temporary response channel)
  clearCache(key: string): Observable<{ status: string }> {
    return this.client.send({ cmd: 'cache.invalidate' }, key);
  }

  // Fire-and-forget Event Publishing
  broadcastAlert(metric: string, level: 'warn' | 'error'): void {
    this.client.emit(`system.alerts.${metric}`, {
      level,
      message: `${metric} exceeded thresholds`,
      timestamp: new Date().toISOString(),
    });
  }
}
```

---

## 5. Driver Telemetry & Low-Level Access

### 5.1 Status Stream & Errors

The Redis driver status stream emits `'connected'`, `'disconnected'`, and `'reconnecting'`:

```typescript
import { RedisStatus, RedisEvents } from '@nestjs/microservices';

this.client.status.subscribe((status: RedisStatus) => {
  console.log(`Redis connection state: ${status}`);
});

// Redis driver uses separate connections for publishing and subscribing.
// The callback receives ('pub' | 'sub') as its first parameter:
this.client.on('error', (clientType: 'pub' | 'sub', err: Error) => {
  console.error(`Redis [${clientType}] socket error:`, err);
});
```

### 5.2 Underlying Driver Access (`unwrap`)

Because Redis Pub/Sub requires dedicated socket connections for publishing and listening, `unwrap()` returns a **tuple of two `ioredis` instances**:

```typescript
import type { Redis } from 'ioredis';

// Tuple: [pubClient, subClient]
const [pubClient, subClient] = this.client.unwrap<[Redis, Redis]>();

// Run native Redis commands on the publisher instance:
await pubClient.set('config:active', 'true');
```

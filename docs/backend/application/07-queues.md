# 07 - Queues & Background Processing

> **Source Reference**: [NestJS Official Documentation - Queues](https://docs.nestjs.com/application/queues)

Queues solve core backend scalability bottlenecks:
1. **Smoothing Peak Traffic**: Rather than failing under sudden spikes of user requests, resource-intensive work is enqueued to Redis and pulled by background workers at controlled rates.
2. **Preventing Event-Loop Starvation**: Heavy CPU/IO tasks (video transcoding, PDF generation, cryptographic operations, AI embeddings) are delegated to background workers so user-facing HTTP threads remain immediately responsive.
3. **Guaranteed Delivery & Retries**: Transient failures (third-party payment gateway 503s, external API rate limits) are handled with deterministic exponential backoff and jitter without losing job state.

---

## 1. BullMQ vs. Bull (Legacy)

NestJS supports two packages:
- **`@nestjs/bullmq` (Recommended)**: Actively developed, TypeScript-first, supports job schedulers, flows (parent-child dependencies), and high-throughput Redis connections.
- **`@nestjs/bull` (Legacy)**: In maintenance mode (bug fixes only).

> **Architectural Standard**: All new projects in `@araz` should standardize on **BullMQ**.

---

## 2. Installation & Module Setup

```bash
pnpm --filter @araz/api add @nestjs/bullmq bullmq
```

### Module Registration in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    // Global Redis connection pool configuration
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs for audit
          removeOnFail: 500,     // Keep last 500 failed jobs for debugging
          attempts: 3,           // Automatically retry failed jobs up to 3 times
          backoff: {
            type: 'exponential',
            delay: 1000,         // 1s, 2s, 4s backoff
          },
        },
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 3. Registering & Producing Jobs

Register a named queue within a feature module:

```typescript
// src/transcoding/transcoding.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TranscodingService } from './transcoding.service.js';
import { TranscodingConsumer } from './transcoding.consumer.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'video-transcode',
    }),
  ],
  providers: [TranscodingService, TranscodingConsumer],
  exports: [TranscodingService],
})
export class TranscodingModule {}
```

### Adding Jobs from a Service (Producer)

Inject the `Queue` using `@InjectQueue('queue-name')`:

```typescript
// src/transcoding/transcoding.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface TranscodeJobPayload {
  mediaId: string;
  sourceUrl: string;
  targetResolution: '720p' | '1080p' | '4k';
}

@Injectable()
export class TranscodingService {
  private readonly logger = new Logger(TranscodingService.name);

  constructor(
    @InjectQueue('video-transcode')
    private readonly transcodeQueue: Queue,
  ) {}

  async queueTranscode(payload: TranscodeJobPayload) {
    this.logger.log(`Enqueueing transcode job for media: ${payload.mediaId}`);

    const job = await this.transcodeQueue.add(
      'transcode-video', // Named job identifier
      payload,
      {
        priority: payload.targetResolution === '4k' ? 1 : 5, // Lower number = higher priority
        delay: 0, // In milliseconds
      },
    );

    return { jobId: job.id, status: 'QUEUED' };
  }
}
```

---

## 4. Consuming Jobs (`WorkerHost`)

In BullMQ, consumers are classes decorated with `@Processor('queue-name')`. They must extend `WorkerHost` and implement the `process()` method:

```typescript
// src/transcoding/transcoding.consumer.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { TranscodeJobPayload } from './transcoding.service.js';

@Processor('video-transcode')
export class TranscodingConsumer extends WorkerHost {
  private readonly logger = new Logger(TranscodingConsumer.name);

  async process(job: Job<TranscodeJobPayload, { outputUrl: string }, string>) {
    this.logger.log(`Processing job ${job.id} [${job.name}] attempt ${job.attemptsMade + 1}`);

    // BullMQ standard pattern for handling multiple job types:
    switch (job.name) {
      case 'transcode-video': {
        const { mediaId, targetResolution } = job.data;

        // Update progress (0 - 100%)
        await job.updateProgress(25);
        // ... perform transcode operation ...

        await job.updateProgress(100);
        return { outputUrl: `https://cdn.araz.io/media/${mediaId}-${targetResolution}.mp4` };
      }

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }
}
```

> **Bull vs BullMQ Named Jobs**: In Bull (v3), individual methods were decorated with `@Process('transcode')`. BullMQ deliberately removes this in favor of standard TypeScript `switch (job.name)` blocks to ensure type safety and eliminate runtime decorator ambiguity.

---

## 5. Listening to Worker & Queue Events

### Worker-Level Events (`@OnWorkerEvent`)
Decorate methods inside the `@Processor()` consumer class to listen to its local events:

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

@Processor('video-transcode')
export class TranscodingConsumer extends WorkerHost {
  private readonly logger = new Logger(TranscodingConsumer.name);

  async process(job: Job) { /* ... */ }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} is now ACTIVE`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: unknown) {
    this.logger.log(`Job ${job.id} COMPLETED with result`, result);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} FAILED: ${error.message}`, error.stack);
  }
}
```

### Global Queue Events (`@QueueEventsListener`)
For listening to queue events from external services without hosting a worker:

```typescript
import { QueueEventsHost, QueueEventsListener, OnQueueEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
@QueueEventsListener('video-transcode')
export class TranscodingQueueEventListener extends QueueEventsHost {
  private readonly logger = new Logger(TranscodingQueueEventListener.name);

  @OnQueueEvent('stalled')
  onStalled(args: { jobId: string }) {
    this.logger.warn(`Job ${args.jobId} marked as STALLED (worker may have crashed)`);
  }
}
```

---

## 6. Sandboxed Processors (Forked Processes)

For CPU-intensive tasks that might block the Node.js event loop, execute the processor in a separate forked OS process:

```typescript
// src/transcoding/transcoding.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { join } from 'node:path';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'heavy-transcode',
      processors: [join(import.meta.dirname, 'transcode.sandboxed-worker.js')],
    }),
  ],
})
export class TranscodingModule {}
```

```typescript
// src/transcoding/transcode.sandboxed-worker.ts (Runs in isolated process)
import type { Job } from 'bullmq';

export default async function (job: Job) {
  // Heavy CPU work here without stalling the NestJS API!
  return { status: 'DONE' };
}
```

---

## 7. Production Observability & Scaling Checklist

| Metric | Target | Action If Breached |
| :--- | :--- | :--- |
| **Queue Wait Time** | < 2 seconds | Time job spends waiting in Redis before a worker picks it up. If high, scale worker pods. |
| **Execution Duration** | Deterministic per job | Time spent inside `process()`. If high, profile code or switch to sandboxed processor. |
| **Failed Job Rate** | < 1% | Track via Prometheus / Datadog. Inspect `job.failedReason` and stack trace. |
| **Redis Memory Utilization** | < 70% | Always configure `removeOnComplete` and `removeOnFail` to prevent Redis OOMs. |

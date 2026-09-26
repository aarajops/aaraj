# 04 - Distributed Tracing

> **Source Reference**: [NestJS Official Documentation - Distributed Tracing](https://docs.nestjs.com/observability/distributed-tracing)

A **distributed trace** captures the complete execution timeline of a single user transaction as it traverses multiple services, asynchronous queue workers, and databases under a single **`traceId`**.

Within a single NestJS service, tracing is completely automatic: the SDK mints a trace ID upon request arrival, and all downstream spans inherit it. Across distributed boundaries, trace propagation ensures that multi-service operations render as a unified waterfall rather than disconnected, fragmented traces.

---

## 1. Extracting the Current Trace ID

Before forwarding a trace context to an external system, retrieve the active ID using `TracerService.currentTraceId()`:

```typescript
// src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

@Injectable()
export class OrdersService {
  constructor(private readonly tracerService: TracerService) {}

  async notifyDownstreamService(orderId: string) {
    const traceId = this.tracerService.currentTraceId();
    // traceId will be null if executed from an untraced context (e.g. standalone script)
    if (traceId) {
      console.log(`Propagating trace: ${traceId}`);
    }
  }
}
```

---

## 2. Cross-Service Propagation by Transport

### 2.1. HTTP to HTTP (Automatic)

HTTP trace propagation is **fully automatic** in both directions:
- **Inbound**: The default `traceIdGenerator` adopts any incoming `x-request-id` header (commonly injected by API Gateways like Envoy, Nginx, or AWS ALB). If missing, it generates a time-ordered UUID v7.
- **Outbound**: The SDK automatically injects the active trace ID as an `x-request-id` header on outbound `fetch`, `undici`, and `node:http` requests on Node.js 22.12+.

#### Manual Axios Interceptor (Node.js < 22.12 Fallback)

```typescript
// src/common/http-trace.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { TracerService } from '@nestjs/observe';

@Module({
  imports: [HttpModule],
})
export class HttpTraceModule implements OnModuleInit {
  constructor(
    private readonly httpService: HttpService,
    private readonly tracerService: TracerService,
  ) {}

  onModuleInit() {
    this.httpService.axiosRef.interceptors.request.use((config) => {
      const traceId = this.tracerService.currentTraceId();
      if (traceId) {
        config.headers['x-request-id'] = traceId;
      }
      return config;
    });
  }
}
```

---

### 2.2. gRPC Microservices

gRPC carries metadata alongside binary RPC payloads:

#### Caller Service (Client)
```typescript
import { Metadata } from '@grpc/grpc-js';

const metadata = new Metadata();
const traceId = this.tracerService.currentTraceId();
if (traceId) {
  metadata.set('x-request-id', traceId);
}
this.usersGrpcClient.getUser({ id: 'usr_1' }, metadata);
```

#### Callee Service (Server)
In the receiving gRPC service, configure `traceIdGenerator` in `createObserveModule()`:

```typescript
// src/app.module.ts (in gRPC service)
import { randomUUID } from 'node:crypto';
import { createObserveModule } from '@nestjs/observe';

export const { ObserveModule, ObserveInstrument } = createObserveModule({
  traceIdGenerator: (call: any) => {
    const inbound = call.metadata?.get?.('x-request-id')?.[0];
    return typeof inbound === 'string' && inbound.length > 0
      ? inbound
      : randomUUID();
  },
});
```

---

### 2.3. Queue Jobs (`@nestjs/bullmq` & `@nestjs/bull`)

Queue job propagation is **completely automatic** in `@nestjs/observe` v0.3.0+:
1. When a job is enqueued (`queue.add()`) from an active request or worker, the SDK stamps the current trace ID onto the job options (`job.opts.observeTraceId`).
2. When a worker in any service picks up the job from Redis, it runs under the enqueuing request's trace ID.
3. If the job fails and is retried, all retry attempts continue using the same original trace ID.

```typescript
// src/checkout/checkout.controller.ts
@Post()
async checkout(@Body() orderDto: OrderDto) {
  const order = await this.ordersService.create(orderDto);
  
  // The background job inherits this HTTP request's traceId automatically!
  await this.notificationsQueue.add('send-invoice', { orderId: order.id });
  
  return order;
}
```

> [!NOTE]
> **Exceptions That Start Independent Traces**:
> - Repeatable cron jobs (`@nestjs/schedule` and `repeat` BullMQ jobs) deliberately mint their own trace ID per execution.
> - Jobs added during application startup (`onModuleInit`) outside an active trace context mint a fresh trace ID.

---

## 3. Understanding the Trace Waterfall in the Dashboard

When examining a trace in the Observe dashboard, keep these diagnostic principles in mind:

```text
[HTTP GET /api/orders/checkout] ──────────────────────── (Total: 450ms, Self: 12ms)
  ├── [AuthGuard.canActivate] ── (Total: 15ms, Self: 15ms)
  └── [OrdersService.checkout] ───────────────────────── (Total: 420ms, Self: 20ms)
        ├── [SELECT users WHERE id = $1] ──── (Total: 40ms, Self: 40ms)
        ├── [PaymentsService.charge] ─────────────── (Total: 280ms, Self: 10ms)
        │     └── [POST https://api.stripe.com/v1/charges] ── (Total: 270ms, Self: 270ms)
        └── [BullMQ: Queue.add 'send-confirmation'] ─ (Total: 80ms, Self: 80ms)
```

### 1. Total Duration vs. Self-Time
- **Total Duration**: Wall-clock time from when the span started until it resolved.
- **Self-Time**: `Total Duration − Sum(Child Spans Duration)`.
- **Diagnostic Rule**: Always sort spans by **Self-Time**. High total duration simply identifies outer wrappers; high self-time reveals the exact database query or slow external HTTP request consuming latency.

### 2. Overlapping Children (Concurrency Flag)
When the sum of child spans exceeds the parent's total duration, the spans executed concurrently (e.g. `Promise.all([fetchA(), fetchB()])`). The dashboard flags these operations with an `Overlapping` badge.

### 3. Log Line Synchronization
Log statements emitted via `ConsoleLogger` with `forwardLogs: true` are pinned directly to the trace timeline at the exact millisecond offset when the line was logged, identifying what the service outputted during each phase of execution.

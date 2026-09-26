# 01 - Resilience (@nestjs/resilience)

> **Source Reference**: [NestJS Official Documentation - Resilience](https://docs.nestjs.com/reliability/resilience)

Sooner or later, every distributed application calling external APIs, databases, or microservices encounters a dependency that is slow or unresponsive. Without proactive fault isolation, a degraded dependency ties up server request handlers, clients wait until their own timeouts trigger, and uncoordinated retries from multiple architectural layers pile catastrophic load onto a service that is already failing.

`@nestjs/resilience` provides an enterprise-grade resilience toolkit exposed as declarative decorators: **retry**, **timeout**, **circuit breaker**, **bulkhead**, and **fallback**. These apply to application **entrypoints** (REST controllers, GraphQL resolvers, microservice message handlers, and WebSocket gateways). For internal domain services, the exact same mechanics are available via policy objects. A unified global interceptor enforces these decorators consistently across all transports, translating failures into transport-native responses (e.g., HTTP `504 Gateway Timeout` or `503 Service Unavailable` with a `Retry-After` header).

---

## 1. Installation & Module Registration

Install `@nestjs/resilience`:

```bash
$ pnpm add @nestjs/resilience
```

Register `ResilienceModule` in your root `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { ResilienceModule } from '@nestjs/resilience';
import { OrdersModule } from './orders/orders.module.js';
import { ShippingModule } from './shipping/shipping.module.js';

@Module({
  imports: [
    ResilienceModule.forRoot({
      defaults: {
        timeout: '5s',
        retry: {
          attempts: 3,
          backoff: { delay: '200ms', maxDelay: '2s' },
        },
      },
      presets: {
        carrier: {
          timeout: '2s',
          retry: { attempts: 2 },
          circuitBreaker: {
            failureRateThreshold: 50,
            minimumCalls: 10,
            openDuration: '30s',
          },
        },
      },
    }),
    OrdersModule,
    ShippingModule,
  ],
})
export class AppModule {}
```

### Configuration Concepts

1. **`defaults`**: Fills in properties for any stage that a decorator or preset enables. Defaults never turn a stage on independently. In the example above, a retry waits a jittered backoff between 0 and 200 ms, doubling each retry up to 2 seconds. A bare `@Timeout()` decorator defaults to 5 seconds.
2. **`presets`**: Configures named bundles of resilience stages, typically organized per external dependency. The `carrier` preset sets a 2-second timeout per attempt, allows up to 2 attempts, and configures a shared circuit breaker. Crucially, this circuit breaker is **shared under the name `'carrier'`** across every route, gateway, and service policy that references the preset.
3. **Bootstrap Verification**: At bootstrap, `ResilienceModule` validates all configurations. Unknown preset names, invalid duration formats, `NaN` values resulting from unset environment variables, or conflicting breaker configurations crash application boot immediately rather than failing during customer requests.

---

## 2. Timeout & Cooperative Cancellation

### The Client and Service

Downstream I/O calls must take an `AbortSignal` to cancel outbound network requests when an attempt exceeds its budget:

```typescript
import { Injectable } from '@nestjs/common';

export interface ShippingQuote {
  service: string;
  price: number;
  estimatedDays: number;
}

export class CarrierError extends Error {
  constructor(readonly status: number) {
    super(`The carrier answered with status ${status}`);
  }
}

@Injectable()
export class CarrierClient {
  private readonly baseUrl = process.env.CARRIER_URL ?? 'https://api.carrier.example.com';

  async getQuotes(orderId: string, signal: AbortSignal): Promise<ShippingQuote[]> {
    const response = await fetch(`${this.baseUrl}/v2/quotes?orderId=${orderId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
    if (!response.ok) throw new CarrierError(response.status);
    return (await response.json()) as ShippingQuote[];
  }
}
```

```typescript
import { Injectable } from '@nestjs/common';
import { CarrierClient, type ShippingQuote } from './carrier.client.js';

@Injectable()
export class ShippingService {
  constructor(private readonly carrierClient: CarrierClient) {}

  getQuotes(orderId: string, signal: AbortSignal): Promise<ShippingQuote[]> {
    return this.carrierClient.getQuotes(orderId, signal);
  }

  flatRateQuotes(): ShippingQuote[] {
    return [{ service: 'flat-rate', price: 4.99, estimatedDays: 5 }];
  }
}
```

### Route-Level Timeout Enforcement

Apply the preset with `@Resilience('carrier')` and inject the attempt's signal using `@Signal()`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { Resilience, Signal, Timeout } from '@nestjs/resilience';
import { ShippingService } from './shipping.service.js';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('quotes')
  @Resilience('carrier')
  @Timeout('1.5s')
  getQuotes(@Query('orderId') orderId: string, @Signal() signal: AbortSignal) {
    return this.shippingService.getQuotes(orderId, signal);
  }
}
```

### Stage-by-Stage Resolution & Cancellation Mechanics

- **Stage Precedence**: Settings resolve stage by stage. The route-level `@Timeout('1.5s')` overrides the preset's 2-second timeout, while the preset still provides the retry and circuit breaker configuration.
- **Cancellation Flow**:
  1. When an attempt exceeds 1.5 seconds, it is rejected with `ResilienceTimeoutError`.
  2. The `AbortSignal` is aborted with that error. Node's `fetch()` rejects and aborts the underlying socket connection immediately, preventing leaked background sockets.
  3. Because `GET` is a safe HTTP method, the preset's retry executes a second attempt. Only pipes, interceptors, and the handler re-run; guards and middleware run once per request.
- **HTTP 504 Gateway Timeout**: If the second attempt also times out, the client receives:

```json
{
  "statusCode": 504,
  "error": "Gateway Timeout",
  "message": "The operation timed out",
  "code": "TIMEOUT"
}
```

> [!NOTE]
> NestJS answers `504` rather than `408 Request Timeout`. A `408` implies the client took too long to send its request body, prompting browsers and proxies to retry automatically (even on `POST` requests).

---

## 3. Circuit Breaker & Fallback Mechanisms

### Fast Failure with Circuit Breakers

A circuit breaker monitors attempt outcomes. The `carrier` breaker opens once it has recorded at least `minimumCalls` (10 calls) and the `failureRateThreshold` (50%) has been reached:

```text
       ┌───────────┐
       │  CLOSED   │◄───────────────────────┐
       └─────┬─────┘                        │
             │ Failures >= Threshold        │ Probe Success
             ▼                              │
       ┌───────────┐  openDuration (30s)  ┌─┴─────────┐
       │   OPEN    ├─────────────────────►│ HALF-OPEN │
       └───────────┘                      └─────┬─────┘
             ▲                                  │
             └──────────────────────────────────┘
                      Probe Failure
```

1. **Closed**: Calls execute normally. Failure rates are measured over a sliding window (default: last 20 calls).
2. **Open**: Calls fail immediately without calling the dependency. Over HTTP, clients receive `503 Service Unavailable` with a `Retry-After: 30` header.
3. **Half-Open**: After `openDuration` expires, the next call acts as a probe. If the probe succeeds, the breaker closes with a clean window. If it fails, the breaker trips back to open for another 30 seconds.

### Client Error Exclusions

By default, 4xx client errors (e.g. `NotFoundException` or `CarrierError` with status 422) are **not counted as failures** and do not trip the circuit breaker, because client errors reflect invalid inputs rather than downstream infrastructure outages. Exceptions to this rule are `408 Request Timeout` and `429 Too Many Requests`, which indicate downstream exhaustion and count as failures. Custom evaluation can be supplied via `recordIf: (error) => boolean`.

### Serving Fallback Responses

A fallback is the outermost resilience stage, capturing rejections from both timeouts and circuit breakers:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { CircuitOpenError, Fallback, Resilience, Signal, Timeout } from '@nestjs/resilience';
import { ShippingService } from './shipping.service.js';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('quotes')
  @Resilience('carrier')
  @Timeout('1.5s')
  @Fallback('flatRateQuotes', {
    handleIf: (error) => error instanceof CircuitOpenError,
  })
  getQuotes(@Query('orderId') orderId: string, @Signal() signal: AbortSignal) {
    return this.shippingService.getQuotes(orderId, signal);
  }

  flatRateQuotes() {
    return this.shippingService.flatRateQuotes();
  }
}
```

- `@Fallback('methodName')`: Calls a method on the same class (or a standalone function) receiving the error and `ExecutionContext`.
- `handleIf`: Constrains fallback activation. In this scenario, flat-rate quotes are served only when the carrier is confirmed down (`CircuitOpenError`), preserving accurate error reporting (`504`) for isolated timeouts.

---

## 4. Bulkhead Concurrency Limiting

A bulkhead caps concurrent executions to protect CPU and memory from being exhausted by expensive operations (e.g., CSV exports):

```typescript
import { Controller, Get, Header } from '@nestjs/common';
import { Bulkhead } from '@nestjs/resilience';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Bulkhead({ maxConcurrent: 2, maxQueue: 3, queueTimeout: '10s' })
  export() {
    return this.ordersService.exportCsv();
  }
}
```

- **Execution Limits**: Exactly 2 exports run concurrently. Up to 3 additional requests wait in the queue for up to 10 seconds.
- **Rejection**: If a sixth request arrives, or a queued request times out after 10 seconds, it is rejected immediately with `503 Service Unavailable`:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "Server is at capacity",
  "code": "BULKHEAD_FULL"
}
```

---

## 5. Safe Retries on Unsafe Operations (`POST`)

By default, `@nestjs/resilience` restricts retries to **safe HTTP methods** (`GET`, `HEAD`, `OPTIONS`) and GraphQL queries. Executing an unconstrained retry on a `POST` risks charging a credit card or creating multiple shipments.

When an operation is idempotent (e.g. deduplicated downstream by order ID), explicit consent is required via `@Retry({ idempotent: true })`:

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { Idempotent } from '@nestjs/idempotency';
import { Resilience, Retry, Signal } from '@nestjs/resilience';
import { ShippingService } from './shipping.service.js';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('shipments')
  @Idempotent()
  @Resilience('carrier')
  @Retry({ idempotent: true })
  createShipment(@Body('orderId') orderId: string, @Signal() signal: AbortSignal) {
    return this.shippingService.createShipment(orderId, signal);
  }
}
```

### Module Registration Order

When pairing `@nestjs/resilience` with `@nestjs/idempotency`, registration order in `AppModule` is critical:

```typescript
@Module({
  imports: [
    // 1. Idempotency interceptor runs outermost
    IdempotencyModule.forRoot({}),
    // 2. Resilience interceptor runs inside Idempotency
    ResilienceModule.forRoot({}),
    ShippingModule,
  ],
})
export class AppModule {}
```

With this order:
1. Replays and in-flight `409` collisions return immediately before resilience retries execute.
2. All server-side retries run under a single idempotency lock.
3. The stored idempotency record reflects the final successful response after internal retries.

---

## 6. Service-Level Policies

Background cron jobs or queue consumers are not HTTP entrypoints. Instead of decorators, they use **policy objects** injected via `ResilienceService`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { CircuitOpenError, ResilienceService, type ResiliencePolicy } from '@nestjs/resilience';
import { OrdersService } from '../orders/orders.service.js';
import { CarrierClient } from './carrier.client.js';

@Injectable()
export class RepricingService {
  private readonly logger = new Logger(RepricingService.name);
  private readonly resiliencePolicy: ResiliencePolicy;

  constructor(
    resilience: ResilienceService,
    private readonly ordersService: OrdersService,
    private readonly carrierClient: CarrierClient,
  ) {
    // Returns the preset containing the exact shared circuit breaker instance
    this.resiliencePolicy = resilience.preset('carrier');
  }

  async repricePendingOrders(): Promise<number> {
    const pending = await this.ordersService.findPending();
    let repriced = 0;

    for (const order of pending) {
      try {
        const quotes = await this.resiliencePolicy.execute(
          ({ signal }) => this.carrierClient.getQuotes(order.id, signal),
          { source: 'RepricingService.repricePendingOrders' },
        );
        const cheapest = Math.min(...quotes.map((q) => q.price));
        await this.ordersService.updateShipping(order.id, cheapest);
        repriced++;
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          this.logger.warn(`Carrier unavailable. Halting repricing job.`);
          break; // Stop immediately rather than waiting for timeouts on every order
        }
        this.logger.error(`Failed repricing order ${order.id}`, error);
      }
    }
    return repriced;
  }
}
```

### Shared State Across Web & Workers

Because `resilience.preset('carrier')` shares the circuit breaker with HTTP routes:
- If HTTP checkout traffic trips the breaker, the background job skips execution immediately.
- If the background job discovers an outage, it trips the breaker, allowing checkout routes to fail fast or serve fallbacks without waiting through timeouts.

---

## 7. Diagnostics Channels & Observability

`@nestjs/resilience` emits strongly-typed events to `ResilienceEvents.events$` and publishes them onto Node.js `node:diagnostics_channel`:

```typescript
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ResilienceEvents } from '@nestjs/resilience';

@Injectable()
export class ResilienceLogger implements OnModuleInit {
  private readonly logger = new Logger('Resilience');

  constructor(private readonly resilienceEvents: ResilienceEvents) {}

  onModuleInit() {
    this.resilienceEvents.events$.subscribe((event) => {
      switch (event.type) {
        case 'circuit-open':
        case 'circuit-closed':
          this.logger.warn(`Circuit "${event.policy}" transitioned: ${event.from} -> ${event.to}`);
          break;
        case 'bulkhead-rejected':
          this.logger.error(`${event.source} bulkhead full (${event.active} active, ${event.queued} queued)`);
          break;
        case 'fallback':
          this.logger.log(`${event.source} invoked fallback due to failure`);
          break;
      }
    });
  }
}
```

Direct diagnostics channel subscription:

```typescript
import { subscribe } from 'node:diagnostics_channel';
import type { ResilienceTimeoutEvent } from '@nestjs/resilience';

subscribe('nestjs:resilience:timeout', (message) => {
  const { policy, timeoutMs } = message as ResilienceTimeoutEvent;
  console.log(`Timeout on policy ${policy} exceeded ${timeoutMs}ms`);
});
```

---

## 8. Unit & E2E Testing with Fake Timers

Resilience tests must not sleep in real-time. Use Vitest or Jest fake timers while preserving real I/O for the HTTP server:

```typescript
import type { INestApplication } from '@nestjs/common';
import { ResilienceService } from '@nestjs/resilience';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { CarrierClient } from '../src/shipping/carrier.client.js';

describe('Shipping Resilience E2E', () => {
  let app: INestApplication;
  const carrier = { getQuotes: vi.fn(), createShipment: vi.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CarrierClient)
      .useValue(carrier)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');

    // Fake ONLY timer queues and Date: preserves supertest and HTTP socket I/O
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('times out after 2 attempts and aborts downstream signal', async () => {
    // Mock carrier hanging indefinitely until aborted
    carrier.getQuotes.mockImplementation((_, signal: AbortSignal) => {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    });

    const responsePromise = request(app.getHttpServer()).get('/shipping/quotes?orderId=1001');

    // Wait until the first call reaches the mock
    await vi.waitFor(() => expect(carrier.getQuotes).toHaveBeenCalled());

    // Advance fake timers through two 1.5s attempts plus backoff
    await vi.advanceTimersByTimeAsync(4000);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    expect(carrier.getQuotes).toHaveBeenCalledTimes(2);

    const [, signal] = carrier.getQuotes.mock.calls[0];
    expect(signal.aborted).toBe(true);
  });

  it('serves fallback when circuit is tripped', async () => {
    const breaker = app.get(ResilienceService).circuitBreaker('carrier');
    breaker.trip(); // Force breaker open directly

    const response = await request(app.getHttpServer()).get('/shipping/quotes?orderId=1001');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ service: 'flat-rate', price: 4.99, estimatedDays: 5 }]);
    expect(carrier.getQuotes).not.toHaveBeenCalled();

    // Advance clock past openDuration (30s) to transition to half-open probe
    vi.advanceTimersByTime(30000);
    carrier.getQuotes.mockResolvedValueOnce([{ service: 'express', price: 12.0, estimatedDays: 1 }]);

    const probeResponse = await request(app.getHttpServer()).get('/shipping/quotes?orderId=1001');
    expect(probeResponse.status).toBe(200);
    expect(breaker.state).toBe('closed');
  });
});
```

---

## 9. Technical Reference

### Module Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaults` | `ResilienceDefaults` | `{}` | Base options for `retry`, `timeout`, `circuitBreaker`, `bulkhead`. Never enables a stage on its own. |
| `presets` | `Record<string, ResiliencePreset>` | `{}` | Named configurations shared across entrypoints and services. |
| `mapErrors` | `boolean` | `true` | Maps resilience errors thrown anywhere into transport native errors. |
| `isGlobal` | `boolean` | `true` | Makes the module and its interceptor available application-wide. |

### Decorators

| Decorator | Key Options | Default |
| :--- | :--- | :--- |
| `@Retry()` | `attempts`, `backoff`, `retryIf`, `idempotent` | `attempts: 3`, safe HTTP methods only unless `idempotent: true`. |
| `@Timeout()` | Duration string or ms | Inherits from preset, then `defaults.timeout`. |
| `@CircuitBreaker()` | `failureRateThreshold`, `minimumCalls`, `slidingWindow`, `openDuration`, `halfOpenMaxCalls`, `recordIf` | `failureRateThreshold: 50`, `minimumCalls: 10`, `openDuration: '30s'`. |
| `@Bulkhead()` | `maxConcurrent`, `maxQueue`, `queueTimeout` | `maxConcurrent: 10`, `maxQueue: 0`. |
| `@Fallback()` | `methodName`, `handleIf` | Replaces non-client errors with fallback return value. |
| `@Resilience()` | `presetName` | Applies preset stages to target handler or controller. |
| `@Signal()` | Parameter decorator | Injects current attempt's `AbortSignal`. |

### Error Mappings

| Error Class | Code | HTTP Status | Client Response Message |
| :--- | :--- | :--- | :--- |
| `ResilienceTimeoutError` | `TIMEOUT` | `504` | "The operation timed out" |
| `CircuitOpenError` | `CIRCUIT_OPEN` | `503` (with `Retry-After`) | "Service temporarily unavailable" |
| `BulkheadFullError` | `BULKHEAD_FULL` | `503` | "Server is at capacity" |
| `OutboundRateLimitError` | `RATE_LIMITED` | `503` (with `Retry-After`) | "Rate limit of a dependency exceeded" |

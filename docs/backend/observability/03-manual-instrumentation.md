# 03 - Manual Instrumentation

> **Source Reference**: [NestJS Official Documentation - Manual Instrumentation](https://docs.nestjs.com/observability/manual-instrumentation)

While `@nestjs/observe` auto-instruments controllers, providers, resolvers, and database drivers out of the box, complex domain logic often demands deeper diagnostic granularity.

The **`TracerService`** provider allows engineers to:
- Nest custom sub-spans within active traces.
- Tag individual spans with operational metadata.
- Capture handled exceptions that would otherwise be hidden from error monitoring.
- Store and retrieve request-scoped attributes without function signature pollution.
- Report real-time custom application metrics (**Counters**, **Gauges**, and **Summaries**).

---

## 1. Injecting `TracerService`

`ObserveModule.forRoot()` registers a global provider exporting `TracerService`. You can inject it directly into any service without re-importing the module:

```typescript
// src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

@Injectable()
export class OrdersService {
  constructor(private readonly tracerService: TracerService) {}
}
```

> [!NOTE]
> **Context Enforcement**:
> Trace-related methods (`createSpan`, `activeSpan`, `setAttribute`, `captureError`) read the active trace from Node.js `AsyncLocalStorage`. Calling these methods outside an instrumented request or job **throws an error** by design, preventing silent span drops.
> 
> The two exceptions are:
> 1. **`currentTraceId()`**: Returns `null` when called outside a trace.
> 2. **Custom Metrics** (`counter`, `gauge`, `summary`): Are process-wide and not bound to a trace.

---

## 2. Creating Custom Spans (`createSpan`)

Use `createSpan(name, callback)` to wrap an operation in a child span. The span duration corresponds exactly to the callback's execution time:

```typescript
// src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

@Injectable()
export class OrdersService {
  constructor(private readonly tracerService: TracerService) {}

  async recalculateCart(cartId: string, discountCode?: string) {
    return this.tracerService.createSpan('orders.recalculateCart', async (span) => {
      span.addTags({ cartId, hasDiscount: String(Boolean(discountCode)) });

      // Heavy computation / external rule evaluation
      const total = await this.computePricingEngine(cartId, discountCode);

      span.setTag('computedTotal', String(total));
      return total;
    });
  }

  private async computePricingEngine(cartId: string, code?: string): Promise<number> {
    return 149.99;
  }
}
```

### Nesting Spans and Call Hierarchies

Calling `createSpan()` inside another span callback automatically establishes parent-child relationships, producing rich nested waterfalls on the Observe dashboard.

### Tagging the Enclosing Active Span (`activeSpan`)

If you want to append tags to whichever span is currently executing without creating a new child span, call `activeSpan()`:

```typescript
const activeSpan = await this.tracerService.activeSpan();
activeSpan.addTags({ cacheHit: 'true', provider: 'redis' });
```

> [!TIP]
> **Naming Convention**:
> Name spans using `<domain>.<action>` format (e.g. `billing.chargeCard`, `inventory.reserveStock`) rather than naming them after calling functions. This allows the dashboard to aggregate performance across all routes calling that operation.

---

## 3. Capturing Handled Errors (`captureError`)

Exceptions that are caught and handled by `try/catch` blocks do not escape the controller and are therefore not captured automatically. Use `captureError()` to send them to the Observe dashboard without re-throwing:

```typescript
// src/payments/payments.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

@Injectable()
export class PaymentsService {
  constructor(private readonly tracerService: TracerService) {}

  async processRefund(paymentId: string) {
    try {
      await this.callPaymentGateway(paymentId);
    } catch (error) {
      // Record error on active trace while allowing fallback execution
      await this.tracerService.captureError(error as Error, {
        paymentId,
        fallbackTriggered: 'true',
      });

      return this.queueOfflineRefund(paymentId);
    }
  }

  private async callPaymentGateway(id: string) {}
  private async queueOfflineRefund(id: string) { return { status: 'queued' }; }
}
```

---

## 4. Request-Scoped Context Store (`setAttribute` / `getAttribute`)

`TracerService` provides access to the trace's contextual store. Attributes set here persist across all downstream providers within the same request lifecycle without parameter drilling:

```typescript
// Setting context in an AuthGuard or Interceptor
this.tracerService.setAttribute('tenantId', account.tenantId);
this.tracerService.setAttribute('userRole', account.role);

// Retrieving context in deep domain services
const tenantId = this.tracerService.getAttribute('tenantId');
```

### Strongly-Typed Store Definition

Pass an interface to `TracerService<T>` for compile-time property validation:

```typescript
interface AarajRequestContext {
  tenantId: string;
  userId: string;
  flags: {
    enableV2Checkout: boolean;
  };
}

@Injectable()
export class CheckoutService {
  constructor(private readonly tracerService: TracerService<AarajRequestContext>) {}

  execute() {
    this.tracerService.setAttribute('flags.enableV2Checkout', true);
  }
}
```

---

## 5. Custom Metrics

NestJS Observe supports three first-class metric types. Metrics are decoupled from traces and can be emitted from background daemons, queue consumers, startup hooks, or cron jobs.

### 5.1. Counter (Monotonically Increasing)
Used for cumulative events (requests served, orders placed, login attempts):

```typescript
const orderCounter = this.tracerService.counter('orders.placed.total', {
  description: 'Total number of successfully placed orders',
  labels: ['region', 'tier'],
});

orderCounter.increment();
```

### 5.2. Gauge (Variable Values)
Used for values that fluctuate up and down (active connection count, queue depth, cache hit ratio):

```typescript
const sessionGauge = this.tracerService.gauge('sessions.active', {
  description: 'Current number of active WebSocket connections',
  kind: 'ratio',
  initialValue: 0,
});

sessionGauge.increment(); // User connected
sessionGauge.decrement(); // User disconnected
sessionGauge.setValue(42);
```

### 5.3. Summary (Quantile Distributions)
Used to measure statistical distributions (latency, response sizes):

```typescript
const lookupDuration = this.tracerService.summary('database.lookup.duration', {
  description: 'Duration of database lookups in milliseconds',
  sampleSize: 1000,
});

const start = performance.now();
try {
  return await this.repository.find();
} finally {
  // Always observe in a finally block to include slow failures
  lookupDuration.observe(performance.now() - start);
}
```

---

## 6. `TracerService` API Quick Reference

| Method | Requires Active Trace? | Return Type | Purpose |
| :--- | :---: | :--- | :--- |
| `createSpan(name, fn)` | Yes | `Promise<T>` | Executes callback inside a new named child span. |
| `activeSpan()` | Yes | `Promise<TraceSpanDelegate>` | Obtains reference to current span for tag manipulation. |
| `captureError(err, tags?)` | Yes | `Promise<void>` | Records a handled error on the active trace. |
| `setAttribute(key, val)` | Yes | `void` | Writes a key-value pair to the request-scoped store. |
| `getAttribute(key)` | Yes | `T \| undefined` | Reads a key from the request-scoped store. |
| `currentTraceId()` | No | `string \| null` | Returns active trace ID or `null` if untraced. |
| `counter(name, attrs?)` | No | `CounterMetric` | Retrieves or creates a monotonic counter metric. |
| `gauge(name, attrs?)` | No | `GaugeMetric` | Retrieves or creates a fluctuating gauge metric. |
| `summary(name, attrs?)` | No | `SummaryMetric` | Retrieves or creates a quantile distribution metric. |

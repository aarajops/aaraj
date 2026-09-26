# 02 - SDK Configuration

> **Source Reference**: [NestJS Official Documentation - Observability SDK](https://docs.nestjs.com/observability/sdk)

The `@nestjs/observe` SDK connects a NestJS application to the **NestJS Observe** platform. It integrates natively with Nest's internal container and request lifecycle—listening to controllers, interceptors, resolvers, providers, and queue consumers without process-wide monkey-patching.

---

## 1. Installation & Compatibility

```bash
pnpm --filter @araz/api add @nestjs/observe
```

> [!WARNING]
> **Compatibility Requirements**:
> The SDK requires **`@nestjs/core` v11.1.4 or later** (which introduced the `instrument` application option) and `@nestjs/graphql` v13.4.4 or later if GraphQL is used.

---

## 2. Quick Start Integration

Integration requires three coordinated steps:

### Step 1 & 2: Instantiate Module in Root (`app.module.ts`)

Call `createObserveModule()` once in your root file. It exports a paired `{ ObserveModule, ObserveInstrument }` bound to the same context:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule({
  sourceContext: {
    linesOfContext: 5,
    maxFrames: 5,
  },
  attachTraceIdToLogs: true,
});

@Module({
  imports: [
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY!,
      appSecret: process.env.OBSERVE_APP_SECRET!,
      serviceId: 'araz-api',
      serviceVersion: process.env.GIT_SHA ?? '1.0.0',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### Step 3: Pass Instrument Hook to `NestFactory.create()`

Pass `ObserveInstrument` into the application options so the SDK binds to the container before handling incoming traffic:

```typescript
// src/main.ts (Express)
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

> [!CAUTION]
> **Critical Rule for Fastify & Explicit Adapters**:
> When passing an explicit adapter (like `FastifyAdapter`), the adapter occupies the **second** parameter, so application options move to the **third** parameter:
> ```typescript
> const app = await NestFactory.create<NestFastifyApplication>(
>   AppModule,
>   new FastifyAdapter(),
>   { instrument: ObserveInstrument }, // MUST BE 3RD ARGUMENT!
> );
> ```
> Passing `{ instrument: ObserveInstrument }` as the 2nd argument alongside an adapter silently discards it, preventing the SDK from ever attaching!

---

## 3. Asynchronous Configuration with `ConfigService`

In production, credentials should be dynamically loaded via `@nestjs/config`:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObserveModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        appKey: config.getOrThrow<string>('OBSERVE_APP_KEY'),
        appSecret: config.getOrThrow<string>('OBSERVE_APP_SECRET'),
        serviceId: config.get<string>('SERVICE_ID', 'araz-api'),
        serviceVersion: config.get<string>('GIT_SHA', '1.0.0'),
        endpoint: config.get<string>('OBSERVE_ENDPOINT', 'https://observe-api.nestjs.com'),
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 4. Automatic Out-of-the-Box Instrumentation

Once attached, the SDK automatically collects the following telemetry without manual code:

### 4.1. Database Driver Spans (Free, Non-Billed)
Database queries (`pg`, `mysql2`, `mongodb`) are detected at the driver layer:
- Supports TypeORM, MikroORM, Drizzle, Mongoose, Sequelize, and Prisma driver adapters.
- **Literal Stripping**: Strings, numbers, and comments are stripped before leaving the process.
- **N+1 Folding**: Repeated sibling queries fold into a single entry with execution counts (e.g. `SELECT users x25`).
- Query spans are **free** and do not consume billable Observability Events.

### 4.2. Outbound HTTP Calls
Outbound network requests initiated via `fetch`, `undici`, or `node:http` (Axios, `@nestjs/http-client`) automatically capture destination spans and inject trace context (`x-request-id`).

```typescript
ObserveModule.forRoot({
  // ...
  outgoing: {
    database: true,
    http: {
      ignore: (url) => url.startsWith('https://internal-metrics.'),
      propagateTraceId: (url) => url.includes('.internal.araz.io'),
    },
  },
});
```

### 4.3. Queue Workers (`@nestjs/bullmq` & `@nestjs/bull`)
Background processors automatically record jobs, queue wait duration, attempt counts, and trace propagation from the enqueuing request.

### 4.4. Runtime Metrics & Heartbeat
Node.js memory heap, event loop delay, garbage collection, and CPU utilization are sampled periodically (`runtimeMetricsInterval: 60000`). If metrics stop arriving, a **Telemetry Silence** alert detects crashed instances.

---

## 5. Capturing Errors with Source Context

When an error escapes a controller or worker, `sourceContext` extracts the exact lines of code surrounding the throwing stack frame:

```typescript
export const { ObserveModule, ObserveInstrument } = createObserveModule({
  sourceContext: {
    linesOfContext: 5,  // Lines to read before and after throwing frame
    maxFrames: 5,       // Max application frames to inspect
    sourceMaps: false,  // Set true if running compiled JS without --enable-source-maps
  },
});
```

### Capturing Request Data on Failure or Slow Latency

```typescript
ObserveModule.forRoot({
  // ...
  http: {
    capture: {
      headers: ['user-agent', 'x-tenant-id'],
      body: { maxBytes: 4096 }, // Scrubbed before sending
      slowerThanMs: 2000,       // Also capture requests running >2 seconds
    },
  },
});
```

---

## 6. Logs & Defense-in-Depth Redaction

Setting `forwardLogs: true` routes all `ConsoleLogger` messages to the Observe dashboard, synchronizing each line with the active trace waterfall.

All forwarded logs, error messages, and captured bodies undergo automated redaction:

```typescript
ObserveModule.forRoot({
  // ...
  forwardLogs: true,
  redaction: {
    enabled: true,
    useDefaultPatterns: true, // Redacts bearer tokens, JWTs, card numbers, private keys
    keys: ['internalToken', 'sessionSecret'],
    patterns: [/usr_[a-z0-9]{16}/gi],
    replacement: '[REDACTED]',
  },
});
```

---

## 7. Filtering & User Attribution

### Ignoring Noisy Operations

Skip non-essential endpoints to conserve billing and eliminate dashboard noise:

```typescript
ObserveModule.forRoot({
  // ...
  http: {
    ignore: [
      '/api/health',
      '/favicon.ico',
      { method: 'GET', path: /^\/metrics/ },
    ],
    getUserId: (req) => req.user?.id ?? 'anonymous',
    tags: { env: process.env.NODE_ENV ?? 'development' },
    setAttributes: (req) => ({
      'client.ip': req.ip,
    }),
  },
});
```

---

## 8. Configuration Reference Summary

| Scope | Option | Description |
| :--- | :--- | :--- |
| `createObserveModule()` | `sourceContext` | Configures lines of source code attached to error frames. |
| `createObserveModule()` | `traceIdKey` | Context key storing trace ID (default `'traceId'`). |
| `createObserveModule()` | `traceIdGenerator` | Custom trace ID minting function (defaults to `x-request-id` or UUID v7). |
| `createObserveModule()` | `attachTraceIdToLogs` | Automatically prepends trace ID to `ConsoleLogger` output. |
| `createObserveModule()` | `skipInstrumentation` | Predicate to exclude specific providers from instrumentation. |
| `forRoot()` | `appKey` / `appSecret` | Project authentication credentials. |
| `forRoot()` | `serviceId` | Unique application identifier within project. |
| `forRoot()` | `serviceVersion` | Release/commit identifier for regression tracking. |
| `forRoot()` | `http` / `jobs` / `ws` | Transport-specific hooks (`getUserId`, `ignore`, `tags`, `setAttributes`). |
| `forRoot()` | `outgoing` | Controls automated database query and outbound HTTP spans. |
| `forRoot()` | `runtimeMetrics` | Toggles heartbeat and CPU/memory/event-loop metrics. |
| `forRoot()` | `forwardLogs` | Streams application log entries to Observe dashboard. |
| `forRoot()` | `redaction` | Configures pattern and key scrubbing rules. |
| `forRoot()` | `tracesSampleRate` | Percentage of traces sent (0.0 - 1.0) or dynamic predicate. |

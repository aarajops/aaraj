# Health Checks & Probes (Terminus)

> **Domain**: Orchestration Health Probes, Service Availability & Graceful Termination  
> **Source Reference**: [NestJS Terminus Recipe](https://docs.nestjs.com/recipes/terminus)  
> **Package**: `@nestjs/terminus` | `@nestjs/axios`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In containerized production environments (such as Kubernetes, AWS ECS, or Google Cloud Run), container orchestrators continuously probe applications to verify if they are healthy enough to receive ingress traffic (**readiness**) and whether they are deadlocked and must be restarted (**liveness**).

The `@nestjs/terminus` package provides health check orchestrations, built-in database/network/memory indicators, custom indicator factories, and graceful termination hooks.

---

## 1. Installation

```bash
pnpm add @nestjs/terminus @nestjs/axios axios
```

---

## 2. Setting Up the Health Module & Controller

```typescript
// apps/api/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  @Get('liveness')
  @HealthCheck()
  checkLiveness() {
    // Lightweight check: Verifies event loop and memory footprint
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // Max 300MB heap
    ]);
  }

  @Get('readiness')
  @HealthCheck()
  checkReadiness() {
    // Thorough check: Verifies external dependencies before receiving traffic
    return this.health.check([
      () => this.db.pingCheck('database').withTimeout(1500).cacheFor(5000),
      () => this.disk.checkStorage('disk_storage', { path: '/', thresholdPercent: 0.85 }),
    ]);
  }
}
```

```typescript
// apps/api/src/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    TerminusModule.forRoot({
      errorLogStyle: 'json',
      gracefulShutdownTimeoutMs: 5000,
    }),
    HttpModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
```

---

## 3. Built-In Health Indicators Reference

| Indicator | Method Call | Description |
| :--- | :--- | :--- |
| **HTTP / API** | `http.pingCheck('api', url)` | Sends HTTP GET; passes on 2xx responses. |
| **HTTP Custom** | `http.responseCheck('auth', url, res => res.status === 204)` | Validates custom HTTP status criteria. |
| **Database** | `db.pingCheck('database', { connection })` | Executes `SELECT 1` against PostgreSQL/MySQL/Oracle/HANA. |
| **Memory Heap** | `memory.checkHeap('heap', bytes)` | Verifies V8 allocated heap memory usage. |
| **Memory RSS** | `memory.checkRSS('rss', bytes)` | Verifies Resident Set Size RAM memory allocation. |
| **Disk Storage** | `disk.checkStorage('disk', { path, thresholdPercent })` | Checks remaining filesystem storage capacity. |

---

## 4. Custom Health Indicators (`attempt`, `up`, `down`, `degraded`)

When verifying custom domain dependencies (e.g. an internal payment gateway or gRPC microservice), implement a custom health indicator using `HealthIndicatorService`:

```typescript
// apps/api/src/health/indicators/redis.health.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisClient: Redis,
  ) {}

  isHealthy(key: string) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async ({ signal }) => {
        // Pass signal to cancel lingering calls upon timeout
        const pong = await this.redisClient.ping();
        if (pong !== 'PONG') {
          throw new Error('Unexpected ping response');
        }
        return { status: 'connected' };
      })
      .withTimeout(1000)
      .cacheFor(3000); // Cache for 3s to reduce Redis load
  }
}
```

### The `degraded()` State

Not every issue justifies pulling a pod out of rotation. For non-critical dependencies (e.g. recommendation cache), return `degraded()`. The HTTP response code remains `200 OK`, allowing traffic to flow while alerting monitoring dashboards:

```typescript
async isHealthy(key: string) {
  const indicator = this.healthIndicatorService.check(key);
  const cacheConnected = await this.cache.isConnected();

  if (!cacheConnected) {
    return indicator.degraded('Cache offline; serving via primary database');
  }

  return indicator.up();
}
```

---

## 5. Graceful Termination & Kubernetes Ingress Draining

When a pod receives a `SIGTERM` signal during a rolling deployment, Kubernetes immediately begins removing the pod IP from service endpoints. However, there is often a multi-second propagation delay before edge routers stop forwarding new requests.

By configuring `gracefulShutdownTimeoutMs: 5000` in `TerminusModule.forRoot()`, Terminus intercepts `SIGTERM`, switches health status to `shutting_down` (answering `503 Service Unavailable`), and delays process exit for 5 seconds to finish in-flight requests cleanly:

```typescript
// Enable shutdown hooks in main.ts
app.enableShutdownHooks();
```

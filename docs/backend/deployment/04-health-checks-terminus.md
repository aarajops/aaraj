# Production Health Checks & Probes (Terminus)

> **Source**: https://docs.nestjs.com/recipes/terminus  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/terminus`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

In cloud-native containerized architectures (Kubernetes, AWS ECS, Google Cloud Run), orchestrators continuously monitor service health via automated HTTP probes.

NestJS provides official health check integrations via the **`@nestjs/terminus`** package, which executes comprehensive readiness and liveness checks across databases, caches, disk storage, and external HTTP APIs.

---

## 1. Liveness vs. Readiness Probes

Orchestrators require distinct probes to manage application lifecycles safely:

| Probe Type | Endpoint | Evaluates | Orchestrator Action on Failure |
| :--- | :--- | :--- | :--- |
| **Liveness Probe** | `/health/liveness` | Is the Node.js event loop responsive? Has memory leaked beyond safety limits? | **Restarts the container** (kills and recreates the pod). |
| **Readiness Probe** | `/health/readiness` | Can the service connect to PostgreSQL, Redis, and message queues? | **Removes pod from service endpoints** (stops routing traffic until dependencies recover). |

> [!CAUTION]
> **Never Check External Databases in Liveness Probes**:
> If your database suffers a temporary network blip and your **liveness probe** fails, Kubernetes will restart all your API pods simultaneously—causing a catastrophic cascading restart loop. Only evaluate external infrastructure in **readiness probes**.

---

## 2. Installation & Setup

Install Terminus along with Axios for HTTP indicators:

```bash
pnpm add @nestjs/terminus @nestjs/axios axios
```

---

## 3. Production Health Controller Implementation

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { Transport } from '@nestjs/microservices';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly http: HttpHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
  ) {}

  /**
   * Liveness Probe: Verifies Node process vitality.
   * If this fails, Kubernetes restarts the pod.
   */
  @Get('liveness')
  @HealthCheck()
  checkLiveness() {
    return this.health.check([
      // Restart container if heap memory exceeds 512MB (OOM leak protection)
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      // Restart if resident set size exceeds 1024MB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }

  /**
   * Readiness Probe: Verifies critical infrastructure connectivity.
   * If this fails, Kubernetes stops sending traffic to this pod.
   */
  @Get('readiness')
  @HealthCheck()
  checkReadiness() {
    return this.health.check([
      // 1. Verify Primary Database connectivity
      () => this.db.pingCheck('database', { timeout: 3000 }),

      // 2. Verify Redis / Microservice Broker connectivity
      () =>
        this.microservice.pingCheck('redis_broker', {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT) || 6379,
          },
          timeout: 2000,
        }),

      // 3. Verify Local Ephemeral Disk Capacity (alert if <15% free)
      () =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.85,
        }),

      // 4. Verify Downstream Auth Provider availability
      () =>
        this.http.pingCheck('auth_provider', 'https://auth.internal/health', {
          timeout: 2000,
        }),
    ]);
  }
}
```

### 3.1 Registering the Health Module

```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

---

## 4. Authoring Custom Health Indicators

When evaluating custom in-memory stores, specialized hardware, or third-party SDK connections, extend `HealthIndicator`:

```typescript
// src/health/custom-cache.indicator.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

@Injectable()
export class CustomCacheHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isConnected = await this.checkCacheSocket();

    const result = this.getStatus(key, isConnected, {
      activeConnections: 12,
      latencyMs: 1.4,
    });

    if (isConnected) {
      return result;
    }

    throw new HealthCheckError('Custom cache ping failed', result);
  }

  private async checkCacheSocket(): Promise<boolean> {
    // Custom socket ping logic
    return true;
  }
}
```

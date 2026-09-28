# Production Deployment & Cloud Operations

> **Source**: https://docs.nestjs.com/deployment  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Deploying a NestJS application to production requires transforming development code into an optimized, secure, and resilient runtime artifact. This guide covers the essential deployment lifecycle: compiling production bundles, setting environment variables, implementing health monitoring, logging best practices, scaling strategies, and zero-configuration cloud deployment with **Mau**.

---

## 1. Prerequisites for Production

Before initiating deployment, verify:
- **Node.js Runtime**: Node.js 24 LTS installed on the host environment (NestJS v12 minimum requirement is Node.js 20.19+ or 22.12+).
- **Environment Configuration**: A complete set of production environment variables securely stored in a secrets manager or injected via cloud runtime configs (never committed to Git).
- **External Dependencies**: Managed database instances (PostgreSQL, MongoDB), caching layers (Redis), and message brokers (RabbitMQ, Kafka, NATS) provisioned with accessible network routes.
- **Port Allocation**: The target platform routes incoming traffic to the port read by your application (`process.env.PORT`, default `3000`).

---

## 2. Compiling the Application (`nest build`)

In development, TypeScript executes via ts-node, SWC, or Vite. In production, code must be pre-compiled into pure JavaScript:

```bash
# In the Aaraj monorepo
pnpm --filter @aaraj/api build
```

This command runs `nest build`, which invokes the TypeScript compiler (`tsc`) with configured NestJS AST transformers (e.g., Swagger or GraphQL CLI plugins) and copies configured static assets into the output directory.

### 2.1 The Monorepo Output Directory Gotcha

> [!WARNING]
> In a standalone project where only files inside `src/` exist, TypeScript emits directly to `dist/main.js`.
> 
> However, in a monorepo or project where root-level `.ts` files exist (such as `vitest.config.ts` or contracts references), TypeScript mirrors the root structure inside `dist/`, resulting in:
> ```bash
> dist/
> └── src/
>     ├── main.js
>     ├── app.module.js
>     └── ...
> ```
> Always verify your entrypoint path inside your production startup scripts (`node dist/src/main.js`).

---

## 3. Runtime Environment & `NODE_ENV=production`

Node.js and third-party libraries (including Express, Fastify, and template engines) optimize their execution paths when `NODE_ENV` is set to `production`:
- Disables expensive development-only diagnostics and stack trace formatting.
- Enables internal memory caching for templates and routing lookups.
- Suppresses verbose debug logging.

Run your compiled application with:

```bash
NODE_ENV=production node dist/src/main.js
```

### 3.1 Graceful Process Shutdown

In Kubernetes or cloud container platforms, pods receive `SIGTERM` signals before termination. Ensure your NestJS application cleanly releases database pools, terminates active WebSocket connections, and closes open socket listeners:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable graceful termination on SIGTERM and SIGINT
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server listening on port ${port}`);
}
void bootstrap();
```

---

## 4. Production Health Checks (`@nestjs/terminus`)

Container orchestrators (Kubernetes, AWS ECS) depend on health check probes to determine whether an application container is healthy and ready to receive traffic.

Nest provides the official `@nestjs/terminus` package:

```bash
pnpm add @nestjs/terminus
```

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Reject probe if heap memory exceeds 300MB
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
```

---

## 5. Enterprise Logging Best Practices

1. **Structured JSON Output**: In production, write log lines as single-line JSON strings to `stdout`. Cloud log forwarders (AWS CloudWatch, Datadog Agent, FluentBit) parse JSON natively, enabling instant filtering by severity, timestamp, and user context.
2. **Propagate Trace & Correlation IDs**: Inject an `x-correlation-id` into every log entry across HTTP, WebSockets, and microservices to trace requests through distributed services.
3. **Never Log Sensitive Data**: Sanitize passwords, authorization tokens, credit card numbers, and PII before writing to log streams.
4. **Tune Severity Levels**: Disable `debug` and `verbose` logs in production to reduce log storage costs and CPU serialization overhead.

---

## 6. Observability with NestJS Observe

While logs and health probes indicate if a server is online, they do not pinpoint which database query degraded latency or which line threw a runtime exception.

Use [NestJS Observe](https://www.observe.nestjs.com/) for zero-overhead auto-instrumentation:

```typescript
import { NestFactory } from '@nestjs/core';
import { ObserveInstrument } from '@nestjs/observe';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, {
  instrument: ObserveInstrument,
});
```

Attach `serviceVersion` metadata to track latency and error budgets across deployments:

```bash
OBSERVE_SERVICE_VERSION=v1.2.0 OBSERVE_API_KEY=your_key node dist/src/main.js
```

---

## 7. Scaling Up vs. Scaling Out

### 7.1 Vertical Scaling (Scaling Up)
- Increasing CPU cores, RAM, and disk IOPS on a single machine or VM.
- **Advantages**: Simple, requires no distributed synchronization or load balancing changes.
- **Limitations**: Hard hardware ceilings, creates a single point of failure (SPOF).

### 7.2 Horizontal Scaling (Scaling Out)
- Deploying multiple stateless instances of the application behind a load balancer (AWS ALB, Nginx, Kubernetes Service).
- **Advantages**: Infinite theoretical scale, high availability, redundancy during rolling updates.
- **Architectural Requirements**:
  - Services must be **completely stateless**: no local in-memory session storage.
  - User sessions stored in Redis or encoded in signed JWTs.
  - WebSocket gateways clustered via `@socket.io/redis-adapter`.
  - Cron tasks protected with distributed locks (`@nestjs/locks`).

---

## 8. Easy Cloud Deployment with Mau (AWS)

[Mau](https://mau.nestjs.com/) is the official deployment platform for NestJS applications on Amazon Web Services (AWS). It automates provisioning, infrastructure orchestration, database creation, and CI/CD pipelines with a single command.

### 8.1 Deploying via Nest CLI

As of NestJS v12, the Nest CLI ships a built-in `deploy` command:

```bash
nest deploy
```

If `@nestjs/mau` is not installed, the CLI prompts to add it and executes the deployment.

### 8.2 Deploying via Mau CLI (CI/CD Non-Interactive)

For automated CI/CD pipelines (GitHub Actions, GitLab CI):

```bash
# Install Mau CLI
pnpm add -g @nestjs/mau

# Deploy to production environment
mau deploy --token=$MAU_API_TOKEN
```

### 8.3 Mau Capabilities Overview

| Capability | Mau Implementation |
| :--- | :--- |
| **Compute Orchestration** | Deploys APIs, microservices, and serverless background workers on AWS. |
| **Managed Databases** | One-click provisioning of PostgreSQL, MySQL, MongoDB (DocumentDB), and Redis. |
| **Distributed Brokers** | Managed RabbitMQ, Kafka, and NATS clusters configured with VPC peering. |
| **Background Tasks** | Native execution of scheduled CRON jobs and BullMQ queue workers. |
| **Monitoring & Alarms** | Automatic CloudWatch metrics integration, uptime monitoring, and alerting. |
| **Zero-Downtime Rollouts**| Automated rolling deployments with health check verification. |

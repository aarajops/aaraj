# 09 - Lifecycle Events

> **Source Reference**: [NestJS Official Documentation - Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)

Every Nest application undergoes a structured lifecycle managed by the runtime container. Nest provides **lifecycle hooks** that give developers visibility into key phases and allow executing cleanup or initialization logic across modules, providers, and controllers.

---

## 1. Lifecycle Sequence Overview

The application lifecycle divides into three phases: **Initializing**, **Running**, and **Terminating**:

```text
[INITIALIZING PHASE]
  1. Module Dependencies Resolved
  2. onModuleInit() executes across all modules & providers
  3. onApplicationBootstrap() executes
  4. HTTP Server starts listening for inbound connections

[RUNNING PHASE]
  5. Application is active and processing requests

[TERMINATING PHASE] (Triggered by SIGTERM / SIGINT or app.close())
  6. onModuleDestroy() executes
  7. beforeApplicationShutdown() executes
  8. HTTP Server stops accepting new connections; active sockets close
  9. onApplicationShutdown() executes
  10. Node.js process exits
```

---

## 2. Hook Methods & Execution Order

| Hook Method | Lifecycle Phase | Trigger & Semantics |
| :--- | :--- | :--- |
| `onModuleInit()` | Initializing | Called immediately after the host module's dependencies are resolved. |
| `onApplicationBootstrap()` | Initializing | Called after **all** application modules have initialized, immediately before listening for traffic. |
| `onModuleDestroy()` | Terminating | Called after a shutdown signal (`SIGTERM`) is received. |
| `beforeApplicationShutdown()` | Terminating | Called after all `onModuleDestroy()` handlers have finished. Existing connections will now close. |
| `onApplicationShutdown()` | Terminating | Called as the final step after connections are closed. Receives the trigger signal (e.g. `'SIGTERM'`). |

### ⚠️ Execution Ordering Guarantees
* **Initialization Order**: Deepest imported modules (leaf dependencies) and global modules execute their `onModuleInit()` hooks first; the root `AppModule` executes last.
* **Shutdown Order**: Teardown hooks run in the exact **reverse** order (root module first, leaf dependencies last).
* **Request Scope Exclusion**: Lifecycle hooks are **never called on request-scoped providers**. Request-scoped instances are ephemeral and decoupled from the application lifecycle.

---

## 3. Implementing Lifecycle Hooks

Implement the corresponding TypeScript interface on any provider, controller, or module:

```typescript
import {
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
  Logger,
} from '@nestjs/common';

@Injectable()
export class CacheWarmupService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CacheWarmupService.name);

  async onModuleInit(): Promise<void> {
    this.logger.log('Warming up high-priority product caches...');
    await this.preloadCache();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Received ${signal}. Flushing in-flight writes and disconnecting...`);
    await this.flushBuffer();
  }

  private async preloadCache() { /* ... */ }
  private async flushBuffer() { /* ... */ }
}
```

---

## 4. Enabling Shutdown Hooks in Production (`enableShutdownHooks`)

By default, Node.js process termination listeners consume resources and are disabled in NestJS. To enable graceful shutdown in containerized environments (e.g. Kubernetes, Docker, Cloud Run), you **must opt in** by calling `enableShutdownHooks()`:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Starts listening for SIGTERM, SIGINT, etc.
  app.enableShutdownHooks();

  await app.listen(3001);
}

await bootstrap();
```

### Kubernetes Graceful Termination
When Kubernetes scales down a Pod or deploys a new release:
1. Kubernetes sends `SIGTERM` to the container.
2. Nest's `enableShutdownHooks()` catches `SIGTERM`.
3. `beforeApplicationShutdown()` and `onApplicationShutdown()` run, allowing in-flight HTTP requests and database transactions to finish cleanly before Kubernetes sends `SIGKILL`.

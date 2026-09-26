# 07 - Lazy-Loading Modules

> **Source Reference**: [NestJS Official Documentation - Lazy-Loading Modules](https://docs.nestjs.com/fundamentals/lazy-loading-modules)

By default, NestJS eagerly loads every module in the application graph during application bootstrap. For standard long-running server instances (e.g. Docker containers on Kubernetes), eager loading is ideal because all dependency resolution, connection pooling, and compilation occur upfront.

However, in **serverless environments** (e.g. AWS Lambda, Google Cloud Run) or event-driven worker processes, eager loading can increase cold-start latency. **Lazy-loading modules** allows loading specific sub-graphs on demand.

---

## 1. Syntax & Mechanics with `LazyModuleLoader`

Nest provides the `LazyModuleLoader` utility class, which can be injected into any service:

```typescript
import { Injectable } from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';

@Injectable()
export class ReportDispatcherService {
  constructor(private readonly lazyModuleLoader: LazyModuleLoader) {}

  async generatePdfReport(data: unknown) {
    // Dynamically import the module file
    const { HeavyPdfModule } = await import('./pdf/heavy-pdf.module.js');

    // Load the module into the Nest runtime graph
    const moduleRef = await this.lazyModuleLoader.load(() => HeavyPdfModule);

    // Retrieve the target service from the lazy module reference
    const { PdfGeneratorService } = await import('./pdf/pdf-generator.service.js');
    const pdfService = moduleRef.get(PdfGeneratorService);

    return pdfService.render(data);
  }
}
```

---

## 2. Caching & Performance

* **Cached on First Call**: When `lazyModuleLoader.load()` is invoked for the first time, Nest compiles and caches the module.
* **Subsequent Invocations**: Subsequent calls return the cached module reference in sub-millisecond time (`~0.2ms`).
* **Shared Module Graph**: Lazy-loaded modules share the existing singleton provider instances already present in the root application graph.

---

## 3. Critical Architectural Limitations

> **WARNING**: Lazy loading modules in NestJS has several strict constraints:

1. **No Lazy Controllers**: You **cannot** lazy-load HTTP controllers. Fastify and Express require all route paths to be registered before the server starts listening for connections.
2. **No Lazy WebSockets or Microservices**: WebSocket gateways and microservice message subscribers (Kafka, RabbitMQ) cannot be lazy-loaded because subscriptions must be established during server boot.
3. **No Dynamic Middleware**: You cannot register middleware via `configure(consumer: MiddlewareConsumer)` in a lazy-loaded module.
4. **Lifecycle Hooks Ignored**: `OnModuleInit`, `OnApplicationBootstrap`, and shutdown hooks are **not triggered** in lazy-loaded modules.
5. **No Global Modules**: Lazy-loaded modules cannot be registered as `@Global()`.

---

## 4. When to Use Lazy Loading

* **Serverless Functions**: Multiple lambda endpoints packaged in a single deployment artifact that only need specific providers per invocation.
* **Background Queue Workers**: Workers that process rare, heavyweight jobs (e.g. video transcoding or financial report generation).
* **Avoid in Monoliths**: For standard REST APIs (such as `@araz/api`), eager loading remains the recommended industry standard.

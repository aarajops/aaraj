# 11 - Platform Agnosticism

> **Source Reference**: [NestJS Official Documentation - Platform Agnosticism](https://docs.nestjs.com/fundamentals/platform-agnosticism)

Nest is designed as a **platform-agnostic framework**. Its architectural building blocks (controllers, services, guards, interceptors, pipes, exception filters) are decoupled from the underlying transport protocol and HTTP server implementation.

---

## 1. "Build Once, Use Everywhere"

The same business logic, validation pipelines, and authorization guards written for an HTTP REST application can be reused across:
1. **HTTP Platforms**: Interchangeable between `@nestjs/platform-express` and `@nestjs/platform-fastify`.
2. **Microservices**: Transport layers such as gRPC, Apache Kafka, RabbitMQ, Redis Pub/Sub, and NATS.
3. **WebSockets**: Real-time bidirectional event streaming via Socket.IO or `ws`.
4. **GraphQL**: Schema-first or code-first GraphQL APIs.
5. **Standalone Execution Contexts**: CLI tools, cron workers, and data migration scripts.

---

## 2. Platform Independence: Express vs. Fastify

By default, Nest uses the Express adapter (`@nestjs/platform-express`). If extreme throughput and low latency are required, migrating to Fastify requires only changing the platform adapter during bootstrap:

### Fastify Setup
```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.listen(3001, '0.0.0.0');
}
bootstrap();
```

> **Agnosticism Best Practice**: Avoid directly importing `Request` or `Response` from `express` or `fastify` in business services. Use standard NestJS decorators (`@Body()`, `@Param()`, `@Query()`, `@Headers()`).

---

## 3. Standalone Applications (`createApplicationContext`)

Not every Nest application is an HTTP server. For background job workers, CLI utilities, and database seeding scripts, use `NestFactory.createApplicationContext()`:

```typescript
// scripts/seed-database.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { SeederService } from '../src/database/seeder.service.js';

async function run() {
  // Bootstraps the full Nest IoC container without binding an HTTP port
  const app = await NestFactory.createApplicationContext(AppModule);

  const seeder = app.get(SeederService);
  await seeder.seed();

  await app.close();
}

run();
```
This boots the application graph, executes dependency injection and asynchronous providers, and closes cleanly when finished.

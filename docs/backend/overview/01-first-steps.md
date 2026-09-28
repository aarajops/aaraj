# 01 - First Steps

> **Source Reference**: [NestJS Official Documentation - First Steps](https://docs.nestjs.com/first-steps)

This guide covers the core fundamentals of NestJS, how an application is structured and bootstrapped, platform adapters, and how `@aaraj/api` adheres to industry best practices.

---

## 1. Language & Module System

Nest is written in TypeScript and runs on Node.js. In the `@aaraj` monorepo, `@aaraj/api` is configured as a modern **ECMAScript Module (ESM)**:

* `apps/api/package.json` specifies `"type": "module"`.
* `tsconfig.json` specifies `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.
* **ESM Requirement**: All relative imports in TypeScript source files must end with `.js` (e.g. `import { AppModule } from './app.module.js';`).

---

## 2. Runtime & Prerequisites

NestJS requires Node.js **v20.19+**, **v22.12+**, or **v24+**.
* The Aaraj repository is pinned to **Node.js 24 LTS** (`>=24.15.0 <25`) and uses **pnpm 12.5.1**.
* Package management is governed strictly by the root `pnpm-lock.yaml`.

---

## 3. Project Structure

A standard NestJS service is structured around cohesive, modular components:

```text
apps/api/src/
├── app.controller.spec.ts     # Controller unit tests (Vitest)
├── app.controller.ts          # Root HTTP route handler
├── app.module.ts              # Root IoC module
├── app.service.ts             # Root business logic provider
├── configure-app.ts           # Reusable application configuration (prefixes, CORS, pipes)
└── main.ts                    # Application entry point and HTTP bootstrap
```

### Core File Responsibilities

| File | Purpose |
| :--- | :--- |
| `main.ts` | The entry file that uses `NestFactory` to instantiate the application and start the HTTP server. |
| `configure-app.ts` | Encapsulates app configuration (e.g. global `/api` prefix, CORS, pipes) so both `main.ts` and E2E test suites share identical setups. |
| `app.module.ts` | The root module that bundles controllers, providers, and imported feature modules. |
| `app.controller.ts` | Handles incoming HTTP requests and delegates work to service providers. |
| `app.service.ts` | Encapsulates business logic, data persistence, and domain workflows. |
| `app.controller.spec.ts` | Unit tests executing against isolated controller instances. |

---

## 4. Bootstrapping the Application

The `main.ts` file contains an asynchronous bootstrap function:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // If an error occurs during initialization, throw it rather than exiting with code 1
    abortOnError: false,
  });

  // Apply standardized global configuration
  configureApp(app);

  // Enable graceful shutdown hooks for SIGTERM / SIGINT
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
}

await bootstrap();
```

### Shared Configuration (`configure-app.ts`)

To prevent divergence between local development, production, and end-to-end testing, configuration logic is centralized:

```typescript
import type { INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): INestApplication {
  // Global path prefix for all endpoints
  app.setGlobalPrefix('api');

  // Standardized Cross-Origin Resource Sharing
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  return app;
}
```

---

## 5. Platform Independence: Express vs. Fastify

Nest is platform-agnostic and interfaces with underlying HTTP engines through adapters. Two platforms are supported out of the box:

1. **`@nestjs/platform-express`** (Default):
   * Built on Express.js.
   * Mature, battle-tested, with universal community middleware compatibility.
   * Types: `NestExpressApplication`.
   ```typescript
   import { NestFactory } from '@nestjs/core';
   import type { NestExpressApplication } from '@nestjs/platform-express';
   import { AppModule } from './app.module.js';

   const app = await NestFactory.create<NestExpressApplication>(AppModule);
   ```

2. **`@nestjs/platform-fastify`**:
   * Built on Fastify.
   * High-performance, low-overhead HTTP engine optimized for high-throughput microservices.
   * Types: `NestFastifyApplication`, requires `FastifyAdapter`.

> **Best Practice**: Avoid coupling application logic directly to `req` or `res` objects of Express or Fastify. Use standard Nest decorators (`@Body()`, `@Param()`, `@Res({ passthrough: true })`) so platform migration remains effortless.

---

## 6. Running & Tooling

### Development Commands
```bash
# Start backend in watch mode
pnpm --filter @aaraj/api dev

# Run unit tests with Vitest
pnpm --filter @aaraj/api test

# Run End-to-End tests
pnpm --filter @aaraj/api test:e2e

# Run linter
pnpm --filter @aaraj/api lint

# Check TypeScript types
pnpm --filter @aaraj/api typecheck
```

### High-Speed Tooling
* **Oxlint**: Ultra-fast Rust-based linter used for immediate feedback (`pnpm lint`).
* **Prettier**: Deterministic code formatting (`.prettierrc`).
* **Vitest**: Native ESM test runner configured in `vitest.config.ts` and `vitest.config.e2e.ts`.

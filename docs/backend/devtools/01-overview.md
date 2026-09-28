# NestJS Devtools Setup, Graph Explorer & Diagnostics

> **Domain**: Application Introspection, Graph Topology & Runtime Debugging  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

[NestJS Devtools](https://devtools.nestjs.com) provides an interactive, visual representation of your application's dependency injection container, routes, enhancers, execution flows, and startup timings.

Instead of mentally parsing hundreds of module definitions and constructor signatures, Devtools renders an up-to-date, searchable, interactive topology of your entire system.

---

## 1. Quickstart & Bootstrap Configuration

Connecting your local application to Devtools requires two steps: enabling graph snapshot collection in `main.ts` and mounting `DevtoolsModule` in your root `AppModule`.

### Step 1: Install Devtools Integration

```bash
pnpm add @nestjs/devtools-integration
```

### Step 2: Enable `snapshot: true` in `src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    snapshot: true, // Enables metadata collection for Devtools
  });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

### Step 3: Register `DevtoolsModule` in `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    DevtoolsModule.register({
      http: process.env.NODE_ENV !== 'production', // Never expose introspection in production
      port: Number(process.env.DEVTOOLS_PORT ?? 8000), // Default port is 8000
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

> **Production Safety**: When `http: false`, `DevtoolsModule` starts no HTTP listener. The `snapshot` collection overhead during bootstrap is negligible (metadata is gathered once at startup and does not affect HTTP request handling).

Start your app in development mode (`pnpm start:dev`) and navigate to [devtools.nestjs.com](https://devtools.nestjs.com) to view the live graph.

---

## 2. Graph Explorer Features

* **Modules vs. Classes View**: Toggle between high-level architectural module boundaries and granular provider/controller dependency edges.
* **Filter Global Modules**: Every module links to `InternalCoreModule` by default. Select **"Hide global modules"** in the sidebar to declutter the graph.
* **Subtree Isolation ("Focus")**: Click any node and select **Focus** to isolate only its immediate upstream and downstream dependencies.
* **Export Diagrams**: Click **Export as PNG** in the bottom-right corner to embed current dependency topologies into pull request descriptions or technical documentation.

---

## 3. Visual Debugging of "Cannot Resolve Dependency"

When an unprovided token or missing module import breaks bootstrap, Nest normally halts with a cryptic stack trace. Devtools can generate a **partial graph** that pinpoint the broken link visually.

### Configure Partial Graph Dump (`main.ts`)

```typescript
import { NestFactory, PartialGraphHost } from '@nestjs/core';
import * as fs from 'node:fs';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    snapshot: true,
    abortOnError: false, // Prevents immediate termination on DI error
  });

  await app.listen(3000);
}

bootstrap().catch((_err) => {
  // Dump partial graph to root directory
  fs.writeFileSync('graph.json', PartialGraphHost.toString() ?? '');
  console.error('Bootstrap failed. Partial dependency graph dumped to graph.json');
  process.exit(1);
});
```

### Diagnosing in Devtools
1. Open [devtools.nestjs.com](https://devtools.nestjs.com).
2. Switch from **Interactive** mode to **Preview** mode.
3. Drag and drop the generated `graph.json` file.
4. Devtools highlights the exact module and unresolved provider in red, displaying recommended fixes (e.g., "Import `BillingModule` into `OrdersModule`").

---

## 4. Routes Explorer & Enhancer Flow Graph

The **Routes Explorer** displays all application entrypoints across HTTP routes, WebSocket events, gRPC endpoints, and GraphQL resolvers.

Clicking any route displays its complete, resolved **Execution Flow Graph**:
- Inbound Middleware sequence
- Guard evaluation order (Global ➔ Controller ➔ Route)
- Interceptor pre-controller pipeline
- Pipe transformation sequence
- Interceptor post-response stream

This eliminates guesswork when debugging why a specific guard or pipe is not executing on an endpoint.

---

## 5. Playground Sandbox

The **Playground** enables real-time execution of TypeScript snippets directly against your running application without requiring server restarts or external HTTP clients:

1. **Authentication**: Devtools generates a transient token on startup:
   ```text
   Sandbox session token: a1b2c3d4-e5f6-7890-...
   ```
2. **Execute In-Memory**: Invoke methods directly on injectable providers (`app.get(OrdersService).findAll()`).
3. **Bypass Guards**: Test internal business logic without generating temporary JWTs or creating throwaway user accounts.
4. **Pretty Printing**: Use `console.table(result)` or `table(result)` to render tabular database results.

---

## 6. Bootstrap Performance Analyzer & Audits

### Performance Profiling
The **Bootstrap Performance** page benchmarks instantiation times for every module, controller, and provider:
* Identifies blocking synchronous work inside constructors.
* Flags long-running async operations inside `onModuleInit` lifecycle hooks.
* Essential for minimizing cold starts in serverless functions (AWS Lambda).

### Architectural Audits
The **Audit** engine runs static analysis over the serialized graph to flag enterprise anti-patterns:
* Controllers with excessive route counts (> 20 endpoints).
* High fan-out modules with unconstrained dependency graphs.
* Providers named `*Guard` or `*Interceptor` that were never registered in DI.
* Request-scoped providers that should be converted to [durable providers](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/fundamentals/03-injection-scopes.md#durable-providers).

---

## 7. Static Offline Graph Export

Export the serialized application graph for offline code reviews or arch docs:

```typescript
import { SerializedGraph } from '@nestjs/core';
import * as fs from 'node:fs';

await app.init();
fs.writeFileSync('./graph.json', app.get(SerializedGraph).toString());
```

# NestJS Enterprise Recipes & Specialized Architecture Standards

> **Domain**: Advanced Design Patterns, Performance Optimization & Framework Extensions  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The NestJS Recipes suite provides official architectural playbooks for addressing specialized enterprise challenges. These range from ultra-fast compilation toolchains and interactive runtime inspection to CQRS event-sourcing engines, high-availability health probes, and distributed execution context propagation.

```text
                            NESTJS ENTERPRISE RECIPES
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│ Tooling & Speed  │          │ Domain Patterns  │          │ State & Probes   │
├──────────────────┤          ├──────────────────┤          ├──────────────────┤
│ • SWC (Rust JIT) │          │ • CQRS (Buses,   │          │ • Terminus       │
│ • REPL Console   │          │   Sagas, Events) │          │   Health Probes  │
│ • CRUD Generator │          │ • Router Module  │          │ • Passport Auth  │
│ • Webpack HMR    │          │ • Serve Static   │          │ • AsyncLocal-    │
│ • Commander CLI  │          │ • Nest Commander │          │   Storage (ALS)  │
└──────────────────┘          └──────────────────┘          └──────────────────┘
```

---

## 1. Recipes Architectural Taxonomy

| Category | Recipe Guide | Primary Technology | Enterprise Use Case |
| :--- | :--- | :--- | :--- |
| **Developer Productivity** | [01 - REPL Interactive Console](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/01-repl.md) | Node.js REPL / `repl()` | Debugging DI containers, testing provider methods live, and inspecting graph state. |
| **Code Generation** | [02 - CRUD Generator](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/02-crud-generator.md) | `@nestjs/schematics` | Scaffold complete REST, GraphQL, Microservice, and WebSocket resources in seconds. |
| **Compiler Toolchain** | [03 - SWC (Fast Compiler)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/03-swc.md) | `@swc/core` / Rust | 20x faster compilation during local development and testing with Vitest/Jest. |
| **Authentication** | [04 - Passport (Auth)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/04-passport.md) | `@nestjs/passport` | End-to-end Local and JWT strategies, `@Public()` routing, and GraphQL resolvers. |
| **Live Reloading** | [05 - Hot Reload (HMR)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/05-hot-reload.md) | Webpack / Rspack | Sub-second stateful reloading without full process restarts or `EADDRINUSE` port locks. |
| **Routing Topology** | [06 - Router Module](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/06-router-module.md) | `RouterModule` (`@nestjs/core`) | Hierarchical module-level path prefixes (`/admin/dashboard`, `/admin/metrics`). |
| **Health & Operations**| [07 - Health Checks (Terminus)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/07-health-checks.md) | `@nestjs/terminus` | Kubernetes liveness/readiness probes, DB pings, memory limits, and zero-downtime shutdown. |
| **Domain Architecture**| [08 - CQRS Architecture](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/08-cqrs.md) | `@nestjs/cqrs` | Segregating reads and writes via CommandBus, QueryBus, EventBus, Sagas, and Aggregate Roots. |
| **Asset Delivery** | [09 - Serve Static Assets](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/09-serve-static.md) | `@nestjs/serve-static` | Serving Single-Page Applications (React/Vue/Angular) with client-side fallback routes. |
| **Standalone Binaries**| [10 - Nest Commander](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/10-commander.md) | `nest-commander` | Standalone CLI tools powered by NestJS dependency injection and lifecycle hooks. |
| **Context Propagation**| [11 - Async Local Storage](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/11-async-local-storage.md) | `node:async_hooks` | Request tracking, trace ID propagation, and context sharing without REQUEST scopes. |

---

## 2. Recipes Documentation Suite Index

1. **[01 - REPL Interactive Console](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/01-repl.md)**: Interactive terminal environment (`repl(AppModule)`), native commands (`get`, `methods`, `debug`, `resolve`), and persistent shell history (`.nestjs_repl_history`).
2. **[02 - CRUD Generator Schematics](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/02-crud-generator.md)**: Scaffolding full-stack domain resources (`nest g resource`) across REST, GraphQL (code-first & schema-first), Microservices, and WebSocket gateways.
3. **[03 - SWC Compiler Toolchain](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/03-swc.md)**: High-speed Rust-based compilation (`--builder swc`), asynchronous type checking (`--type-check`), CLI plugin metadata generation, circular dependency workarounds (`Relation<T>`), and Vitest/Jest configuration.
4. **[04 - Passport Authentication](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/04-passport.md)**: Enterprise authentication architecture: LocalStrategy (passwords), JwtStrategy (bearer tokens), global `JwtAuthGuard` with `@Public()` metadata reflection, and GraphQL execution context adapters.
5. **[05 - Hot Reload (HMR)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/05-hot-reload.md)**: Webpack Hot-Module Replacement, graceful server disposal (`module.hot.dispose`), port reuse, and migrating to modern Rspack bundlers.
6. **[06 - Router Module](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/06-router-module.md)**: Declaring module-level route prefixes with `RouterModule.register()`, organizing hierarchical sub-modules, and clean API gateway routing.
7. **[07 - Health Checks with Terminus](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/07-health-checks.md)**: Orchestrator health monitoring: TypeORM/Mongoose database pings, memory leak guards (`checkHeap`, `checkRSS`), disk capacity checks, custom indicators (`attempt()`, `degraded()`), and Kubernetes zero-downtime shutdown timeouts (`gracefulShutdownTimeoutMs`).
8. **[08 - CQRS Event-Driven Architecture](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/08-cqrs.md)**: Command and Query Responsibility Segregation: CommandBus, QueryBus, EventBus, RxJS Sagas, flexible Aggregate Roots (Class, Mixin, Interface), request-scoped handlers with `AsyncContext`, and `UnhandledExceptionBus`.
9. **[09 - Serve Static Assets](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/09-serve-static.md)**: Hosting frontend SPA client bundles with `ServeStaticModule`, client-side routing fallback (`index.html`), Fastify fallthrough compatibility, and cache-control tuning.
10. **[10 - Nest Commander CLI](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/10-commander.md)**: Building standalone CLI applications with NestJS DI: `@Command()`, `CommandRunner`, `@Option()` flags, automated error exit codes, and unit testing with `CommandTestFactory`.
11. **[11 - Async Local Storage (ALS)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/11-async-local-storage.md)**: Cross-cutting context propagation without request-scoped provider performance penalties: hand-rolled middleware ALS, automated trace context with `@nestjs/observe` (`TracerService`), and `nestjs-cls` continuation storage.

---

## 3. Enterprise Best Practices & Production Checklist

- [ ] **Adopt SWC or Rspack for Sub-Second Rebuilds**: Replace slow TypeScript compiler passes during iterative local development by configuring `"builder": "swc"` or `"builder": "rspack"`.
- [ ] **Enforce Type Checking in CI**: SWC skips type validation by default. Always pair SWC builds with `tsc --noEmit` or `--type-check` in CI/CD pipelines to prevent type regressions.
- [ ] **Use AsyncLocalStorage Instead of Request-Scoped Providers**: Where possible, avoid `Scope.REQUEST` on core services to prevent memory bloat and instance recreation overhead. Propagate request metadata via `AsyncLocalStorage` or `@nestjs/observe`.
- [ ] **Configure Graceful Shutdown in Terminus**: Pair `@nestjs/terminus` with `app.enableShutdownHooks()` and configure `gracefulShutdownTimeoutMs: 5000` to allow Kubernetes ingress controllers time to update endpoints before pods terminate.
- [ ] **Separate CQRS Sagas from Domain Aggregates**: Ensure domain aggregates apply events to express state transitions, while long-running multi-service workflows and compensating actions are coordinated via RxJS Sagas.

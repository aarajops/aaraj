# NestJS FAQ & Advanced Runtime Architecture Standards

> **Domain**: Enterprise Runtime Edge Cases, Framework Internals & Diagnostic Standards  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The **FAQ** tier addresses common real-world operational challenges, low-level HTTP transport internals, serverless deployment patterns, multi-transporter topologies, and complex dependency injection diagnostics encountered across enterprise production environments.

```text
                           NESTJS RUNTIME FAQ & INTERNALS
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌──────────────────┐           ┌──────────────────┐           ┌──────────────────┐
│  Serverless &    │           │  HTTP Transport  │           │ Diagnostics &    │
│  Hybrid Runtimes │           │  & Protocol Edge │           │ Execution Flow   │
├──────────────────┤           ├──────────────────┤           ├──────────────────┤
│ • AWS Lambda     │           │ • HttpAdapterHost│           │ • Request        │
│ • Standalone App │           │ • Raw Body Buffers│           │   Lifecycle Flow │
│ • Multi-Transport│           │ • Keep-Alive Conns│           │ • Dependency DI  │
│   Hybrid Services│           │ • HTTPS Dual-Port│           │   Resolution     │
│ • Inherit Config │           │ • Global Prefixes│           │ • Watch Polling  │
└──────────────────┘           └──────────────────┘           └──────────────────┘
```

---

## 1. FAQ Architecture & Operational Taxonomy

| Category | Chapter | Core API / Focus | Production Scenario |
| :--- | :--- | :--- | :--- |
| **Serverless Computing** | [01 - Serverless](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/01-serverless.md) | AWS Lambda / `@codegenie/serverless-express` | Cold start minimization, bundling with Webpack/Rspack, standalone contexts, and Swagger redirection. |
| **Engine Abstraction** | [02 - HTTP Adapter](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/02-http-adapter.md) | `HttpAdapterHost` / `AbstractHttpAdapter` | Accessing raw Express/Fastify engine instances, registering low-level hooks, and `listen$` streams. |
| **Connection Pooling** | [03 - Keep-Alive Connections](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/03-keep-alive-connections.md) | `forceCloseConnections: true` | Terminating persistent socket connections during shutdown hooks and watch mode reloads to prevent `EADDRINUSE`. |
| **Routing Topography** | [04 - Global Path Prefix](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/04-global-prefix.md) | `setGlobalPrefix()` / `path-to-regexp` | Application-wide versioning prefixes, health check exclusions, and named wildcard parameters (`*splat`). |
| **Payload Integrity** | [05 - Raw Body Handling](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/05-raw-body.md) | `RawBodyRequest<T>` / `req.rawBody` | Webhook cryptographic signature verification (Stripe, GitHub, Shopify) in Express and Fastify adapters. |
| **Multi-Transport** | [06 - Hybrid Applications](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/06-hybrid-application.md) | `connectMicroservice()` / `inheritAppConfig` | Dual-role services handling incoming HTTP traffic while listening to message queues (TCP, Redis, NATS, Kafka). |
| **Network Security** | [07 - HTTPS & Multiple Servers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/07-multiple-servers.md) | `httpsOptions` / `http.createServer` | Dual HTTP/HTTPS ports, TLS certificate binding, Fastify TLS options, and graceful multi-server shutdown observers. |
| **Execution Pipeline** | [08 - Request Lifecycle](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/08-request-lifecycle.md) | Middleware ➔ Guard ➔ Interceptor ➔ Pipe ➔ Filter | Strict phase order, binding priority (Global vs Controller vs Route), and param pipe reverse resolution. |
| **DI Diagnostics** | [09 - Common Errors & Debugging](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/09-common-errors.md) | `NEST_DEBUG=true` / `forwardRef` | Diagnosing "Cannot resolve dependency", circular file imports, monorepo duplicate packages, and Windows TS 4.9 watch loops. |
| **Reference Ecosystem** | [10 - Official Sample Catalog](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/10-examples.md) | Official Nest Repository Samples | Complete reference index of architectural patterns across microservices, databases, GraphQL, and security. |

---

## 2. Master Navigation Index

1. **[01 - Serverless Computing & Cold Starts](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/01-serverless.md)**: Serverless deployment architecture, compilation benchmarks (`tsc` vs `webpack` vs `rspack`), lazy module loading for cold starts, AWS Lambda handler integration with `@codegenie/serverless-express`, standalone application contexts, and Swagger UI reverse-proxy fix.
2. **[02 - HTTP Adapter & Engine Access](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/02-http-adapter.md)**: Decoupling application logic from underlying HTTP engines, injecting `HttpAdapterHost`, accessing underlying Express or Fastify instances (`getInstance()`), and listening lifecycle observables (`listen$`).
3. **[03 - Keep-Alive Connections & Graceful Shutdown](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/03-keep-alive-connections.md)**: Handling persistent HTTP/1.1 Keep-Alive sockets, preventing process lockups during container restarts, and configuring `forceCloseConnections` in Express and Fastify.
4. **[04 - Global Path Prefix & Route Exclusions](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/04-global-prefix.md)**: Setting enterprise routing prefixes (`setGlobalPrefix`), modern path-to-regexp parameter syntax (`*splat`), and route exclusion rules for liveness and webhook probes.
5. **[05 - Raw Body Buffers & Webhook HMAC Verification](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/05-raw-body.md)**: Preserving unparsed raw request buffers for cryptographic verification, configuring Express `NestExpressApplication` and Fastify `NestFastifyApplication`, and tuning body parser limits.
6. **[06 - Hybrid Applications & Multi-Transporters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/06-hybrid-application.md)**: Architecting hybrid microservices, connecting TCP, Redis, and NATS transports to an HTTP app, configuring `inheritAppConfig: true`, and lifecycle startup sequencing.
7. **[07 - HTTPS Configuration & Multiple Simultaneous Ports](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/07-multiple-servers.md)**: Enabling SSL/TLS in Express and Fastify, provisioning dual HTTP (80) and HTTPS (443) servers on a single application, and implementing an `OnApplicationShutdown` observer to prevent dangling ports.
8. **[08 - Request Lifecycle & Resolution Sequence](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/08-request-lifecycle.md)**: Detailed phase-by-phase breakdown of NestJS execution: Middleware execution order, Guard cascades, Interceptor RxJS pipelines (Pre & Post), Pipe evaluation sequences (reverse parameter order), and Exception Filter hierarchies.
9. **[09 - Common Errors & DI Troubleshooting](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/09-common-errors.md)**: Comprehensive diagnostic manual for resolving missing provider tokens, circular imports vs circular DI dependencies (`forwardRef`), duplicate monorepo packages (`dependenciesMeta.injected`), and TypeScript 4.9+ file watching polling fixes.
10. **[10 - Official Sample Catalog & Architectural Archetypes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/10-examples.md)**: Curated mapping of official NestJS sample codebases covering HTTP, Microservices, WebSockets, Persistence (TypeORM, Prisma, Mongoose), and Security.

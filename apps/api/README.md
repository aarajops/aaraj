# @araz/api - Enterprise Backend Service

The core backend service for the **Araz** enterprise platform, built with **NestJS 12**, **TypeScript (ESM / NodeNext)**, and **Node.js 24 LTS**.

---

## Architecture & Conventions

* **Port**: Runs on port `3001` (configurable via `PORT` environment variable).
* **Global Prefix**: All HTTP routes are served under `/api` (e.g. `http://localhost:3001/api`).
* **Shared Contracts**: Validation DTOs and business schemas are consumed from `@araz/contracts`.
* **Module System**: Pure ECMAScript Modules (`"type": "module"`). All relative imports require `.js` extensions.
* **Testing**: Unit and End-to-End tests powered by **Vitest**.
* **Linting & Formatting**: Enforced via **Oxlint** and **Prettier**.

---

## Architectural Reference Documentation

Comprehensive architectural guidelines and official NestJS standards are maintained in the root `docs/` directory:

* **[Backend Standards & Architecture Index](../../docs/backend/README.md)**
* **[01. First Steps & Bootstrapping](../../docs/backend/01-first-steps.md)**
* **[02. Controllers & Routing](../../docs/backend/02-controllers.md)**
* **[03. Providers & Dependency Injection](../../docs/backend/03-providers.md)**
* **[04. Modules & Encapsulation Boundaries](../../docs/backend/04-modules.md)**
* **[05. Middleware & Consumers](../../docs/backend/05-middleware.md)**
* **[06. Exception Filters & Error Handling](../../docs/backend/06-exception-filters.md)**
* **[07. Pipes & Standard Schema Validation](../../docs/backend/07-pipes.md)**
* **[08. Guards & RBAC Authorization](../../docs/backend/08-guards.md)**
* **[09. Interceptors & Aspect-Oriented Streams](../../docs/backend/09-interceptors.md)**
* **[10. Custom Decorators & Composition](../../docs/backend/10-custom-decorators.md)**
* **[11. Complete Request Lifecycle Pipeline](../../docs/backend/11-request-lifecycle.md)**
* **[Fundamentals & Advanced Architecture Index](../../docs/backend/fundamentals/README.md)**
  * Custom Providers, Async Providers, Dynamic Modules, Scopes, Circular Dependencies, ModuleRef, Lazy Loading, Execution Context, Lifecycles, Discovery, Testing
* **[Application & Production Capabilities Index](../../docs/backend/application/README.md)**
  * Configuration, Validation, Serialization, Logging, Events, Task Scheduling, Queues, HTTP Client, File Storage
* **[Data Persistence & Caching Index](../../docs/backend/data/README.md)**
  * Data Overview, TypeORM, Drizzle ORM, Prisma, MongoDB & Mongoose, MikroORM, Sequelize, Caching & Redis
* **[Security & Threat Mitigation Index](../../docs/backend/security/README.md)**
  * Authentication, Authorization, Encryption & Hashing, Security Headers, CORS, CSRF Protection, Rate Limiting
* **[HTTP Protocol & Web Platform Index](../../docs/backend/http/README.md)**
  * Versioning, Cookies, Session, File Upload & Streaming, Compression, Server-Sent Events, Model-View-Controller, Performance (Fastify)
* **[Observability & APM Index](../../docs/backend/observability/README.md)**
  * NestJS Observe, SDK & Fastify Configuration, Manual Instrumentation, Distributed Tracing, Error Monitoring & Defect Fingerprinting, Dashboard & Profiler, MCP Server Integration
* **[Reliability & Fault Tolerance Index](../../docs/backend/reliability/README.md)**
  * Resilience (`@nestjs/resilience`), Idempotency Keys (`@nestjs/idempotency`), Transactional Outbox (`@nestjs/outbox`), Distributed Locks (`@nestjs/locks`)
* **[GraphQL API & Supergraphs Index](../../docs/backend/graphql/README.md)**
  * Quick Start, Resolvers, Mutations, Subscriptions, Scalars, Directives, Interfaces, Unions & Enums, Field Middleware, Mapped Types, Plugins, Complexity, Extensions, CLI Plugin, Generating SDL, Sharing Models, Other Features, Federation 2
* **[WebSockets & Real-Time Gateways Index](../../docs/backend/websockets/README.md)**
  * Gateways, Exception Filters, Pipes, Guards, Interceptors, Adapters (Socket.IO Redis Clustering & ws)
* **[Microservices & Distributed Transporters Index](../../docs/backend/microservices/README.md)**
  * Transporter Architecture, TCP, Redis, MQTT, NATS (v3), RabbitMQ, Kafka, gRPC, Custom Transporters, Exception Filters, Pipes, Pre-Request Hooks, Guards, Interceptors
* **[Deployment & Cloud Operations Index](../../docs/backend/deployment/README.md)**
  * Production Builds, Multi-Stage Dockerfile (Node 24 + pnpm), Kubernetes Autoscaling, Nginx Reverse Proxy, Terminus Health Checks, Mau AWS Deployment
* **[CLI & Workspaces Architecture Index](../../docs/backend/cli/README.md)**
  * CLI Architecture, Workspaces (Standard vs Monorepo), Monorepo Libraries, CLI Command Reference & Schematics, Scripts & Compilers (tsc, swc, rspack)
* **[OpenAPI (Swagger) Architecture Index](../../docs/backend/openapi/README.md)**
  * Bootstrap, Standard Schema (Zod/Valibot), Types & Parameters, Operations, Security Schemes, Mapped Types, Decorators, CLI Plugin, Multi-Docs
* **[Recipes & Specialized Architectures Index](../../docs/backend/recipes/README.md)**
  * REPL Console, CRUD Generator, SWC Compiler, Passport Auth, Hot Reload (HMR), Router Module, Terminus Health Checks, CQRS Architecture, Serve Static, Nest Commander CLI, Async Local Storage (ALS)

---

## Development Commands

All commands should be executed from the monorepo root:

```bash
# Start API in development watch mode
pnpm dev:api

# Run unit tests
pnpm --filter @araz/api test

# Run E2E tests
pnpm --filter @araz/api test:e2e

# Typecheck TypeScript
pnpm --filter @araz/api typecheck

# Lint with Oxlint
pnpm --filter @araz/api lint

# Production build
pnpm --filter @araz/api build
```

---

## Directory Structure

```text
apps/api/
├── src/
│   ├── app.controller.spec.ts   # Controller unit tests
│   ├── app.controller.ts        # Health and status routes
│   ├── app.module.ts            # Root application module
│   ├── app.service.ts           # Root application service
│   ├── configure-app.ts         # Shared app bootstrap configuration (prefix, CORS)
│   └── main.ts                  # Entry point
├── test/
│   └── app.e2e-spec.ts          # End-to-end integration tests
├── nest-cli.json                # Nest CLI configuration
├── package.json                 # Workspace package configuration
├── tsconfig.json                # TypeScript compiler options
├── vitest.config.ts             # Vitest unit test configuration
└── vitest.config.e2e.ts         # Vitest E2E test configuration
```

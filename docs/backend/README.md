# NestJS Backend Engineering Standards & Reference

This directory serves as the definitive reference guide and architectural playbook for the `@araz/api` service. It distills the official NestJS documentation and enterprise-grade design patterns into actionable, durable documentation.

---

## Overview Table of Contents

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [First Steps](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/01-first-steps.md) | Bootstrap, `NestFactory`, Express vs. Fastify, Node 24 runtime, ESM rules |
| **02** | [Controllers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/02-controllers.md) | Routing, HTTP verbs, route params, query parsing, DTO binding, status codes |
| **03** | [Providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/03-providers.md) | Dependency Injection, tokens, `Scope.DEFAULT` vs `Scope.REQUEST`, custom providers |
| **04** | [Modules](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/04-modules.md) | Encapsulation boundaries, provider exports, shared modules, dynamic modules |
| **05** | [Middleware](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/05-middleware.md) | Express middleware, `NestMiddleware`, `MiddlewareConsumer`, route exclusion |
| **06** | [Exception Filters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/06-exception-filters.md) | Exceptions layer, built-in HTTP errors, machine-readable `errorCode`, custom filters |
| **07** | [Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/07-pipes.md) | Transformation, validation, Standard Schema V1, Zod contracts integration |
| **08** | [Guards](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/08-guards.md) | Authentication, RBAC authorization, `Reflector.createDecorator`, `ExecutionContext` |
| **09** | [Interceptors](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/09-interceptors.md) | AOP, RxJS stream manipulation, response wrapping, caching, timeouts |
| **10** | [Custom Decorators](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/10-custom-decorators.md) | Param decorators, schema validation, composite decorators (`applyDecorators`) |
| **11** | [Request Lifecycle](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/11-request-lifecycle.md) | End-to-end execution pipeline order, timing guarantees, and error bubbling |

---

## Fundamentals & Advanced Architecture Table of Contents

The [fundamentals/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/README.md) directory documents the runtime mechanics and advanced IoC infrastructure:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Custom Providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/01-custom-providers.md) | `useValue`, `useClass`, `useFactory`, `useExisting`, non-class tokens, abstract classes vs interfaces |
| **02** | [Asynchronous Providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/02-async-providers.md) | Async factories, database connections, deferred application bootstrap |
| **03** | [Dynamic Modules](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/03-dynamic-modules.md) | `register`, `forRoot`, `forFeature`, `ConfigurableModuleBuilder`, `setExtras`, async config |
| **04** | [Injection Scopes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/04-injection-scopes.md) | `DEFAULT`, `REQUEST`, `TRANSIENT`, scope bubbling, `REQUEST` token, `AsyncLocalStorage`, durable trees |
| **05** | [Circular Dependency](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/05-circular-dependency.md) | Forward references (`forwardRef()`), module circularity, barrel file anti-patterns |
| **06** | [Module Reference](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/06-module-reference.md) | `ModuleRef`, static `get()`, scoped `resolve()`, `ContextIdFactory`, dynamic `create()` |
| **07** | [Lazy-Loading Modules](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/07-lazy-loading-modules.md) | `LazyModuleLoader`, serverless/worker cold start reduction, controller limitations |
| **08** | [Execution Context](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/08-execution-context.md) | `ArgumentsHost`, `ExecutionContext`, multi-context switching (HTTP/RPC/WS), `Reflector` metadata |
| **09** | [Lifecycle Events](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/09-lifecycle-events.md) | Initialization & shutdown hooks, `enableShutdownHooks()`, Kubernetes `SIGTERM` handling |
| **10** | [Discovery Service](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/10-discovery-service.md) | `DiscoveryService`, runtime introspection of providers & controllers, decorator scanning |
| **11** | [Platform Agnosticism](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/11-platform-agnosticism.md) | Platform independence, Express vs Fastify, microservices & WebSockets transport reusability |
| **12** | [Testing](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/12-testing.md) | Unit testing with Vitest, `TestingModuleBuilder`, auto-mocking (`useMocker`), Supertest E2E |

---

## Application & Production Infrastructure Table of Contents

The [application/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/README.md) directory documents enterprise integration patterns and production capabilities:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Configuration](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/01-configuration.md) | `@nestjs/config`, `.env` resolution, Standard Schema/Zod validation, namespaced configs, `ConfigService` |
| **02** | [Validation](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/02-validation.md) | `StandardSchemaValidationPipe` vs `ValidationPipe`, DTO mapping, Zod contracts, array validation |
| **03** | [Serialization](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/03-serialization.md) | Response shaping, `StandardSchemaSerializerInterceptor`, `ClassSerializerInterceptor`, data stripping |
| **04** | [Logging](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/04-logging.md) | Structured JSON logs, NestJS 12 params, log levels, stdout best practices, request correlation |
| **05** | [Events](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/05-events.md) | `@nestjs/event-emitter`, decoupling services, async events, wildcards, preventing event loss |
| **06** | [Task Scheduling](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/06-task-scheduling.md) | `@nestjs/schedule`, `@Cron()`, intervals, timeouts, `SchedulerRegistry`, distributed locks |
| **07** | [Queues](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/07-queues.md) | `@nestjs/bullmq`, Redis-backed jobs, producers, consumers (`WorkerHost`), retries, sandboxed workers |
| **08** | [HTTP Client](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/08-http-client.md) | `@nestjs/http-client`, native `fetch`, named clients, automatic retries with jitter, error mapping |
| **09** | [File Storage](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/application/09-file-storage.md) | File uploads, `FileInterceptor`, `ParseFilePipe`, `StreamableFile`, S3/GCS object storage patterns |

---

## Data Persistence & Caching Table of Contents

The [data/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/README.md) directory documents database integrations, ORMs, and caching strategies:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Data Overview](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/01-overview.md) | Database agnosticism, architectural paradigms (Data Mapper, Repository, Query Builder), picking the right engine |
| **02** | [TypeORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/02-typeorm.md) | `@nestjs/typeorm`, repository pattern, entities, relations, `autoLoadEntities`, `QueryRunner` transactions, subscribers, testing |
| **03** | [Drizzle ORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/03-drizzle.md) | `@nestjs/drizzle`, Drizzle v1, schema inference (`$inferSelect`), relational queries (`defineRelations`), read replicas, Drizzle Kit |
| **04** | [Prisma](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/04-prisma.md) | Prisma Client, `PrismaService`, connection lifecycle hooks, `$transaction`, client extensions, mocking in Vitest |
| **05** | [MongoDB & Mongoose](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/05-mongodb.md) | `@nestjs/mongoose`, `@Schema()`, `@Prop()`, subdocuments, hooks, replica set transactions, `@InjectModel()` |
| **06** | [MikroORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/06-mikroorm.md) | `@mikro-orm/nestjs`, Unit of Work, Identity Map, request-scoped context forking, migrations |
| **07** | [Sequelize](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/07-sequelize.md) | `@nestjs/sequelize`, `sequelize-typescript`, model decorators, associations, managed transactions |
| **08** | [Caching](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/08-caching.md) | `@nestjs/cache-manager`, Keyv architecture, in-memory & Redis stores (`@keyv/redis`), `CacheInterceptor`, `@CacheKey()`, `@CacheTTL()` |

---

## Security & Threat Mitigation Table of Contents

The [security/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/README.md) directory documents defense-in-depth security, authentication, and policy enforcement:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Authentication](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/01-authentication.md) | `@nestjs/jwt`, `JwtService`, stateless Bearer tokens, `AuthGuard`, global authentication, `@Public()` metadata |
| **02** | [Authorization](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/02-authorization.md) | RBAC (`@Roles()`, `RolesGuard`), Claims-based access, CASL (`@casl/ability`, `MongoAbility`), `PoliciesGuard` |
| **03** | [Encryption & Hashing](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/03-encryption-hashing.md) | AES-256-CTR with `node:crypto`, salted password hashing with `bcrypt` / `argon2`, timing attack prevention |
| **04** | [Security Headers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/04-security-headers.md) | `app.useSecurityHeaders()` (NestJS 12.1+), CSP directives, HSTS, `X-Frame-Options`, Swagger/GraphQL accommodations |
| **05** | [CORS](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/05-cors.md) | `enableCors()`, origin allowlisting, Express vs Fastify method disparity, preflight handling |
| **06** | [CSRF Protection](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/06-csrf-protection.md) | Built-in Fetch Metadata protection (`Sec-Fetch-Site`), trusted origins, webhook exclusions, token fallbacks |
| **07** | [Rate Limiting](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/security/07-rate-limiting.md) | `@nestjs/throttler`, multi-tier throttlers, `@Throttle()`, proxy IP tracking (`X-Forwarded-For`), Redis storage |

---

## HTTP Protocol & Web Platform Table of Contents

The [http/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/README.md) directory documents web protocols, platform adapters, streaming, and performance:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Versioning](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/01-versioning.md) | URI, Header, Media Type (`Accept`), Custom extractors, `@Version()`, `VERSION_NEUTRAL`, default versions |
| **02** | [Cookies](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/02-cookies.md) | Native NestJS 12.1+ cookie API, `@Cookies()`, `@SignedCookies()`, `setCookie()`, secret rotation, `SameSite` |
| **03** | [Session](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/03-session.md) | `express-session`, `@fastify/secure-session`, `@Session()`, cookie signing, distributed Redis storage |
| **04** | [File Upload & Streaming](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/04-file-upload-streaming.md) | Multipart uploads, `FileInterceptor`, `ParseFilePipe`, Fastify streaming (`FileStreamInterceptor`), `StreamableFile` |
| **05** | [Compression](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/05-compression.md) | `compression` (Express), `@fastify/compress` (Brotli/Gzip), quality tuning, reverse proxy offloading |
| **06** | [Server-Sent Events (SSE)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/06-server-sent-events.md) | `@Sse()`, `Observable<MessageEvent>`, `EventSource` protocol, client disconnection, `@SseSignal()` cleanup |
| **07** | [Model-View-Controller (MVC)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/07-mvc.md) | Server-side templating with Handlebars (`hbs`), layouts, static assets (`useStaticAssets`), `@Render()` |
| **08** | [Performance (Fastify)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/08-performance-fastify.md) | `FastifyAdapter`, extreme throughput, low overhead, body limits, route routing differences |

---

## Workspace Conventions for `@araz/api`

### 1. ECMAScript Modules (ESM) & Relative Imports
The backend is built as a pure ESM project (`"type": "module"` in `apps/api/package.json` with TypeScript `moduleResolution: "NodeNext"`).
* **Strict Rule**: All relative file imports **MUST** include the `.js` extension at runtime:
  ```typescript
  // CORRECT
  import { AppService } from './app.service.js';
  import { UsersModule } from './users/users.module.js';

  // INCORRECT (Fails in NodeNext ESM)
  import { AppService } from './app.service';
  ```

### 2. Standard Schema & Shared Contracts
Instead of duplicating validation logic between frontend and backend or using reflection-heavy decorators for basic validation, domain contracts are maintained in `packages/contracts` using **Zod**. NestJS 12 natively supports **Standard Schema V1**, allowing Zod schemas to be used directly in Nest pipes without runtime reflection penalties.

### 3. Dependency Injection Tokens
TypeScript interfaces and type aliases are erased during compilation. When injecting an abstract dependency (such as a database repository or external client interface), you must bind it to an explicit token (Symbol or string) and inject it using `@Inject(TOKEN)`.

### 4. Global Binding via Multi-Providers
Global guards, pipes, interceptors, and filters that require dependency injection **must not** be registered using bare `app.useGlobal*()` calls in `main.ts`. Instead, register them as multi-providers in your root `AppModule`:
```typescript
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
```

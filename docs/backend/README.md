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

## Observability & APM Table of Contents

The [observability/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/README.md) directory documents the official `@nestjs/observe` auto-instrumentation and APM platform:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Overview](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/01-overview.md) | APM comparison, request lifecycle hooks, teams/projects/applications hierarchy, Observability Events (OEs) |
| **02** | [SDK Configuration](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/02-sdk.md) | `createObserveModule()`, `ObserveInstrument`, Fastify 3rd-argument rule, database/HTTP auto-instrumentation, redaction, sampling |
| **03** | [Manual Instrumentation](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/03-manual-instrumentation.md) | `TracerService`, `createSpan()`, `activeSpan()`, `captureError()`, `setAttribute()`, metrics (`counter`, `gauge`, `summary`) |
| **04** | [Distributed Tracing](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/04-distributed-tracing.md) | Trace context propagation, HTTP `x-request-id`, gRPC metadata, BullMQ queue job inheritance, self-time waterfalls |
| **05** | [Error Monitoring](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/05-error-monitoring.md) | Unhandled exceptions, stack traces with `sourceContext`, server-side defect fingerprinting, release regressions |
| **06** | [Dashboard & Analytics](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/06-dashboard.md) | 3-tier navigation (Analytics → Operation → Execution), live Service Map, Profiler, SLO error budget burn rates |
| **07** | [MCP Server](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/observability/07-mcp-server.md) | Streamable HTTP MCP endpoint (`POST /mcp`), personal tokens, automated AI agent root-cause analysis |

---

## Reliability & Fault Tolerance Table of Contents

The [reliability/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/reliability/README.md) directory documents system resilience, fault isolation, idempotency, transactional outbox, and distributed locks:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Resilience](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/reliability/01-resilience.md) | `@nestjs/resilience`, `@Retry()`, `@Timeout()`, `@CircuitBreaker()`, `@Bulkhead()`, `@Fallback()`, service policy objects, diagnostics channels |
| **02** | [Idempotency Keys](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/reliability/02-idempotency-keys.md) | `@nestjs/idempotency`, IETF specification, request fingerprinting, atomic stores (Drizzle, TypeORM, Redis), AES-256-GCM encryption, event deduplication |
| **03** | [Transactional Outbox](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/reliability/03-transactional-outbox.md) | `@nestjs/outbox`, dual-write problem, transactional messaging (`tx`), relay daemon (`SKIP LOCKED`), consumer inboxes, dead-letter queue |
| **04** | [Distributed Locks](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/reliability/04-distributed-locks.md) | `@nestjs/locks`, `@OnOneInstance()`, `@WithoutOverlapping()`, monotonic fencing tokens (`fencingToken`), leader election, Postgres/Redis store contracts |

---

## GraphQL API & Supergraphs Table of Contents

The [graphql/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/README.md) directory documents type-safe data graphs, Apollo Server v5, Mercurius, subscriptions, and federation:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Quick Start](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/01-quick-start.md) | `@nestjs/graphql`, Apollo Server v5, Mercurius, GraphiQL IDE, request context, async config, multi-endpoints |
| **02** | [Resolvers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/02-resolvers.md) | `@Resolver()`, `@Query()`, `@ResolveField()`, `@Parent()`, `@ArgsType()`, generic pagination |
| **03** | [Mutations](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/03-mutations.md) | `@Mutation()`, `@InputType()`, nested inputs, schema-first mutation mapping |
| **04** | [Subscriptions](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/04-subscriptions.md) | `graphql-ws`, `@Subscription()`, `PubSub`, payload filtering, WebSocket authentication |
| **05** | [Scalars](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/05-scalars.md) | Built-in scalar modes, `@Scalar()`, `CustomScalar<T, K>`, `graphql-type-json` |
| **06** | [Directives](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/06-directives.md) | `@Directive()`, schema transformers (`mapSchema`), custom field and query directives |
| **07** | [Interfaces](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/07-interfaces.md) | `@InterfaceType()`, polymorphic types, `resolveType`, interface resolver inheritance |
| **08** | [Unions and Enums](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/08-unions-and-enums.md) | `createUnionType()` with `as const`, `registerEnumType()`, deprecations |
| **09** | [Field Middleware](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/09-field-middleware.md) | `FieldMiddleware`, field value interception, execution ordering vs enhancers |
| **10** | [Mapped Types](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/10-mapped-types.md) | `PartialType()`, `PickType()`, `OmitType()`, `IntersectionType()`, target overrides |
| **11** | [Plugins](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/11-plugins.md) | `@Plugin()`, `ApolloServerPlugin` lifecycle hooks, Mercurius plugins |
| **12** | [Complexity](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/12-complexity.md) | `graphql-query-complexity`, `ComplexityPlugin`, field estimators, DoS mitigation |
| **13** | [Extensions](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/13-extensions.md) | `@Extensions()`, custom metadata, field-level permissions and RBAC |
| **14** | [CLI Plugin](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/14-cli-plugin.md) | AST transformer, automatic field inference, JSDoc introspection, ESM support |
| **15** | [Generating SDL](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/15-generating-sdl.md) | `GraphQLSchemaBuilderModule`, headless schema extraction for CI/CD |
| **16** | [Sharing Models](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/16-sharing-models.md) | `graphql-model-shim`, sharing models between NestJS and browser client bundles |
| **17** | [Other Features](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/17-other-features.md) | `GqlExecutionContext`, guards, interceptors, custom `@User()` decorator, custom drivers |
| **18** | [Federation](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/18-federation.md) | Apollo Federation 1 & 2 (`ApolloFederationDriver`), `@key`, `@ResolveReference()`, gateway supergraph |

---

## WebSockets & Real-Time Gateways Table of Contents

The [websockets/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/README.md) directory documents real-time bidirectional communication, gateways, Socket.IO clustering, and native WS adapters:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Gateways](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/01-gateways.md) | `@WebSocketGateway()`, namespaces, `@SubscribeMessage()`, `@MessageBody()`, `@Ack()`, `WsResponse`, lifecycle hooks, NestJS 12 request-scoped gateways |
| **02** | [Exception Filters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/02-exception-filters.md) | `WsException`, error frames, cause attribution, `BaseWsExceptionFilter`, gateway-level `@UseFilters()` vs global filter bypass |
| **03** | [Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/03-pipes.md) | Validation & transformation, `ValidationPipe` with `WsException` factory, Standard Schema V1 / Zod validation in `@MessageBody({ schema })` |
| **04** | [Guards](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/04-guards.md) | WebSocket authentication & authorization, `context.switchToWs()`, handshake token extraction, RBAC roles, `handleConnection()` vs `@UseGuards()` |
| **05** | [Interceptors](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/05-interceptors.md) | Aspect-oriented programming, latency benchmarking, response enveloping, `client.emit()` direct emit bypass caveat |
| **06** | [Adapters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/websockets/06-adapters.md) | `WebSocketAdapter`, Socket.IO Redis clustering (`@socket.io/redis-adapter`), sticky sessions vs websocket transport, `WsAdapter` with `ws`, custom `messageParser` |

---

## Microservices & Distributed Transporters Table of Contents

The [microservices/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/README.md) directory documents the microservice architectural style, message patterns, and distributed transporters:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Overview](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/01-overview.md) | `createMicroservice()`, TCP transporter, `@MessagePattern()`, `@EventPattern()`, `ClientProxy`, lazy connections, request-scoping (`CONTEXT`), TLS, async config |
| **02** | [Redis](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/02-redis.md) | Pub/Sub engine, fire-and-forget delivery, `RedisContext`, channel wildcards (`psubscribe`), `RedisStatus`, dual-socket driver unwrap (`[pub, sub]`) |
| **03** | [MQTT](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/03-mqtt.md) | IoT messaging, topic wildcards (`+`, `#`), QoS levels (0/1/2), `MqttRecordBuilder`, user properties, `MqttContext` |
| **04** | [NATS](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/04-nats.md) | NATS v3 `@nats-io/transport-node` driver, distributed queue groups, dynamic reply subjects, `NatsRecordBuilder`, JSON message deserialization |
| **05** | [RabbitMQ](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/05-rabbitmq.md) | AMQP exchanges & queues, manual acknowledgments (`noAck: false`, `channel.ack()`), topic exchange wildcards, `RmqRecordBuilder` |
| **06** | [Kafka](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/06-kafka.md) | Distributed log streaming, reply partition sizing, NestJS 12 RegExp patterns (`/^hero\..+$/`), keyed messages, offset commits, retries |
| **07** | [gRPC](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/07-grpc.md) | Protocol Buffers (`.proto`), `@GrpcMethod()`, metadata headers, NestJS 12 status-specific exceptions (`GrpcExceptionFilter`), reflection, streaming |
| **08** | [Custom Transporters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/08-custom-transporters.md) | `CustomTransportStrategy`, extending `Server`, `messageHandlers` map, `propagatesEventHandlerErrors`, custom `ClientProxy` |
| **09** | [Exception Filters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/09-exception-filters.md) | `RpcException`, observable error streams, `BaseRpcExceptionFilter`, event handler error boundaries, `inheritAppConfig` |
| **10** | [Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/10-pipes.md) | Data validation, `ValidationPipe` with `RpcException` factory, Standard Schema V1 / Zod validation in `@Payload({ schema })` |
| **11** | [Pre-Request Hooks](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/11-pre-request-hooks.md) | Middleware equivalent, pipeline order, `AsyncLocalStorage` correlation ID propagation, execution timing |
| **12** | [Guards](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/12-guards.md) | Authorization, `RpcException('Forbidden resource')`, extracting RPC context headers, inter-service authentication |
| **13** | [Interceptors](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/microservices/13-interceptors.md) | Aspect-Oriented Programming (AOP), response enveloping, latency benchmarking, stream timeouts |

---

## Deployment & Cloud Operations Table of Contents

The [deployment/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/README.md) directory documents release engineering, containerization, orchestration, and automated cloud deployments:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Deployment Guide](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/01-deployment.md) | `nest build`, `NODE_ENV=production`, process signals, Terminus health checks, JSON logging, Mau AWS deployment (`nest deploy`) |
| **02** | [Enterprise Docker](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/02-docker.md) | Multi-stage Dockerfile (Node 24 Alpine + pnpm), non-root `node` user, `dumb-init` PID 1 signal forwarding, `.dockerignore` |
| **03** | [Scaling & Clustering](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/03-scaling-clustering.md) | Kubernetes HPA, Nginx reverse proxy (HTTP/2, WebSockets, gRPC), AWS ALB, stateless design principles |
| **04** | [Health Checks & Probes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/04-health-checks-terminus.md) | `@nestjs/terminus`, liveness vs readiness probe separation, database/redis pings, memory leak limits (`checkHeap`) |

---

## CLI & Workspaces Table of Contents

The [cli/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/README.md) directory documents developer tooling, project scaffolding, monorepo orchestration, and compilation backends:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [CLI Overview](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/01-overview.md) | Global vs local binary resolution, Node 24 runtime & ICU validation, ESM scaffolding (Vitest/oxlint), CLI syntax |
| **02** | [Workspaces](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/02-workspaces.md) | Standard mode to monorepo conversion (`nest g app`), `nest-cli.json` schema, global & project compilerOptions, static assets |
| **03** | [Libraries](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/03-libraries.md) | Monorepo internal libraries (`libs/`), `@app/*` path mapping, module exports (`index.ts`), Vitest/Jest resolver configs, Rspack bundling |
| **04** | [Command Reference](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md) | Comprehensive command options (`new`, `generate`, `build`, `start`, `add`, `upgrade`, `deploy`, `info`), schematics reference, Mau integration |
| **05** | [Scripts & Compilers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/05-scripts.md) | `package.json` script orchestration, builder comparison (`tsc` vs `swc` vs `rspack`), AST plugins (Swagger), legacy migration |

---

## OpenAPI (Swagger) Table of Contents

The [openapi/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/README.md) directory documents API contract design, interactive documentation, AST schema inference, and Standard Schema integration:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Introduction & Bootstrap](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/01-introduction.md) | `DocumentBuilder`, deferred `documentFactory` closure, Fastify `@fastify/static`, Helmet CSP, Standard Schema (Zod/Valibot) |
| **02** | [Types & Parameters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/02-types-and-parameters.md) | `@ApiProperty()`, arrays, circular references, `enumName` client SDK deduplication, `@ApiExtraModels()`, polymorphic schemas (`oneOf`) |
| **03** | [Operations & Responses](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/03-operations.md) | OpenAPI 3.2 hierarchical tags (`parent`, `kind`), shorthand responses (`@ApiOkResponse`), multipart uploads, generic `ApiPaginatedResponse` |
| **04** | [Security Schemes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/04-security.md) | `@ApiBearerAuth()`, `@ApiBasicAuth()`, `@ApiOAuth2()` scopes, `@ApiCookieAuth()`, controller vs public route overrides |
| **05** | [Mapped Types](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/05-mapped-types.md) | DRY schema derivation, `PartialType()`, `PickType()`, `OmitType()`, `IntersectionType()`, critical import rule from `@nestjs/swagger` |
| **06** | [Decorators Reference](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/06-decorators.md) | Exhaustive catalog of all 28+ `@Api*` decorators, targets (Method/Controller/Model), and composition via `applyDecorators()` |
| **07** | [CLI Compiler Plugin](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/07-cli-plugin.md) | AST transforms, automatic `@ApiProperty` generation, JSDoc comment introspection (`@remarks`, `@param`), SWC & Jest e2e setup |
| **08** | [Advanced Features & Multi-Docs](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/openapi/08-other-features.md) | Global parameters, global responses, multi-specification partitioning (`include: [Module]`), Explorer dropdown, CI/CD static file export |

---

## Recipes & Specialized Architectures Table of Contents

The [recipes/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/README.md) directory documents official patterns for developer tooling, speed, health, domain architectures, and contextual state:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [REPL Interactive Console](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/01-repl.md) | `repl(AppModule)`, inspection methods (`debug`, `$`, `methods`, `resolve`), command history (`.nestjs_repl_history`) |
| **02** | [CRUD Generator Schematics](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/02-crud-generator.md) | `nest g resource`, REST, GraphQL (code/schema-first), Microservices, WebSockets, ORM-agnostic services |
| **03** | [SWC Compiler Toolchain](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/03-swc.md) | Rust JIT builder (`--builder swc`), `--type-check`, circular relation types (`Relation<T>`), Vitest `unplugin-swc` |
| **04** | [Passport Authentication](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/04-passport.md) | `PassportStrategy`, Local & JWT strategies, global `JwtAuthGuard`, `@Public()` decorator, GraphQL execution context |
| **05** | [Hot Reload (HMR)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/05-hot-reload.md) | Webpack/Rspack HMR, `module.hot.dispose`, `closePromise` port release, `forceCloseConnections` |
| **06** | [Router Module](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/06-router-module.md) | `RouterModule.register()`, hierarchical module path prefixes (`/admin/dashboard`), API gateway routing |
| **07** | [Health Checks (Terminus)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/07-health-checks.md) | Kubernetes liveness/readiness, DB & memory indicators, `attempt()`, explicit `degraded()`, zero-downtime `gracefulShutdownTimeoutMs` |
| **08** | [CQRS Architecture](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/08-cqrs.md) | `CommandBus`, `QueryBus`, `EventBus`, RxJS Sagas, flexible Aggregate Roots, `AsyncContext` request scoping, `UnhandledExceptionBus` |
| **09** | [Serve Static Assets](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/09-serve-static.md) | `ServeStaticModule`, client SPA wildcard fallback (`index.html`), Fastify `fallthrough: true`, caching |
| **10** | [Nest Commander CLI](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/10-commander.md) | Standalone CLI binaries, `@Command()`, `CommandRunner`, `@Option()`, `CommandFactory.run()`, testing with `CommandTestFactory` |
| **11** | [Async Local Storage (ALS)](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/11-async-local-storage.md) | `node:async_hooks`, middleware context propagation, `@nestjs/observe` `TracerService`, `nestjs-cls` continuation storage |

---

## FAQ & Runtime Internals Table of Contents

The [faq/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/README.md) directory documents edge cases, low-level HTTP transport internals, serverless architectures, and dependency injection troubleshooting:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Serverless Computing](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/01-serverless.md) | AWS Lambda / `@codegenie/serverless-express`, cold start optimization, bundled benchmarks, standalone context, Swagger redirect |
| **02** | [HTTP Adapter](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/02-http-adapter.md) | `HttpAdapterHost`, accessing Express/Fastify raw instances (`getInstance()`), engine-specific hooks, `listen$` stream |
| **03** | [Keep-Alive Connections](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/03-keep-alive-connections.md) | `forceCloseConnections: true`, socket lifecycle, watch mode port release, Kubernetes rolling deployment graceful termination |
| **04** | [Global Path Prefix](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/04-global-prefix.md) | `setGlobalPrefix()`, route exclusions (`exclude`), modern `path-to-regexp` rules, named wildcard parameters (`*splat`) |
| **05** | [Raw Body Buffers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/05-raw-body.md) | `RawBodyRequest<T>`, unparsed buffers for webhook HMAC verification (Stripe, GitHub), Express/Fastify configs, parser limits |
| **06** | [Hybrid Applications](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/06-hybrid-application.md) | `connectMicroservice()`, dual HTTP + message brokers (TCP, Redis, NATS), `inheritAppConfig: true`, initialization order |
| **07** | [HTTPS & Multiple Servers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/07-multiple-servers.md) | TLS configuration, dual HTTP (80) & HTTPS (443) ports, Fastify TLS, custom `ShutdownObserver` socket teardown |
| **08** | [Request Lifecycle](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/08-request-lifecycle.md) | Middleware ➔ Guards ➔ Interceptors (Pre) ➔ Pipes (reverse param) ➔ Handler ➔ Interceptors (Post) ➔ Exception Filters |
| **09** | [Common Errors & Debugging](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/09-common-errors.md) | "Cannot resolve dependency", `import type` erasure, circular imports vs circular DI (`forwardRef`), `NEST_DEBUG=true` |
| **10** | [Official Sample Catalog](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/faq/10-examples.md) | Curated architectural index of official NestJS sample repositories across HTTP, Microservices, WebSockets, and Security |

---

## Devtools & Architecture Governance Table of Contents

The [devtools/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/devtools/README.md) directory documents live dependency graph introspection, partial graph debugging, and automated CI/CD architectural drift governance:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Overview & Graph Explorer](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/devtools/01-overview.md) | `snapshot: true`, `DevtoolsModule`, `PartialGraphHost` visual DI debugger, Routes explorer, sandbox Playground, startup profiler |
| **02** | [CI/CD Integration](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/devtools/02-ci-cd-integration.md) | `GraphPublisher`, `preview: true` mode, GitHub Actions & GitLab CI pipelines, Pull Request structural diffing, drift prevention |

---

## Migration Guide (v11 to v12) Table of Contents

The [migration/](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/migration/README.md) directory documents major version upgrades, breaking changes, Standard Schema adoption, and ESM transitions:

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Core Breaking Changes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/migration/01-breaking-changes.md) | Node 24/22 requirements, `@Optional()` inheritance drop, Terminus `HealthIndicatorService`, NATS v3, `graphql-ws` |
| **02** | [CLI, Tooling & Compilers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/migration/02-cli-tooling-and-compilers.md) | `nest upgrade`, Rspack default monorepo builder, Webpack deprecation, Vitest ESM testing, Oxlint linter |
| **03** | [Standard Schema & New Features](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/migration/03-standard-schema-and-features.md) | Standard Schema V1 (`StandardSchemaValidationPipe`), Zod Config, route conflict policies, machine-readable `errorCode` |
| **04** | [ESM Migration Playbook](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/migration/04-esm-migration-playbook.md) | `"type": "module"`, `NodeNext` resolution, mandatory `.js` relative imports, `import.meta.dirname`, Supertest defaults |

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

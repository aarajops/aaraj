# Araz Engineering Documentation Portal

Welcome to the central documentation portal for the **Araz** platform. This repository contains the authoritative architecture standards, engineering guides, and technology reference documentation for building and scaling the enterprise monorepo.

---

## Documentation Structure

```text
docs/
├── README.md                      # Documentation portal entry point (this file)
└── backend/                       # NestJS backend architectural standards & guides
    ├── README.md                  # Backend overview & design philosophy
    ├── 01-first-steps.md          # Bootstrapping, runtime, platform adapters, and tooling
    ├── 02-controllers.md          # Routing, request/response lifecycle, DTOs, and decorators
    ├── 03-providers.md            # Dependency injection, tokens, scopes, and custom providers
    ├── 04-modules.md              # Encapsulation, boundaries, exports, and dynamic modules
    ├── 05-middleware.md           # Middleware functions, consumers, and route exclusions
    ├── 06-exception-filters.md    # Error handling layer, HTTP exceptions, and custom filters
    ├── 07-pipes.md                # Data transformation, Standard Schema, and Zod validation
    ├── 08-guards.md               # Authentication, RBAC authorization, and metadata reflection
    ├── 09-interceptors.md         # AOP, RxJS stream manipulation, caching, and timeouts
    ├── 10-custom-decorators.md    # Param decorators, schema parsing, and decorator composition
    ├── 11-request-lifecycle.md    # Deterministic end-to-end request execution pipeline
    └── fundamentals/              # Advanced IoC container & runtime infrastructure
        ├── README.md              # Fundamentals guide index
        ├── 01-custom-providers.md # Dynamic DI, value/class/factory providers
        ├── 02-async-providers.md  # Asynchronous bootstrapping & connection pools
        ├── 03-dynamic-modules.md  # ConfigurableModuleBuilder, dynamic module APIs
        ├── 04-injection-scopes.md # Singleton, Request, Transient, durable trees
        ├── 05-circular-dependency.md # forwardRef(), module circularity, barrel fixes
        ├── 06-module-reference.md # ModuleRef, dynamic instantiation, context IDs
        ├── 07-lazy-loading-modules.md # LazyModuleLoader, serverless optimization
        ├── 08-execution-context.md # ArgumentsHost, ExecutionContext, Reflector
        ├── 09-lifecycle-events.md # OnModuleInit, OnApplicationShutdown, SIGTERM
        ├── 10-discovery-service.md # DiscoveryService, runtime introspection
        ├── 11-platform-agnosticism.md # Express, Fastify, microservices, CLI
        └── 12-testing.md          # Unit testing with Vitest, auto-mocking, Supertest
    └── application/               # Enterprise integration patterns & infrastructure
        ├── README.md              # Application guide index
        ├── 01-configuration.md    # @nestjs/config, Zod validation, namespaced configs
        ├── 02-validation.md       # StandardSchemaValidationPipe, contracts, coercion
        ├── 03-serialization.md    # StandardSchemaSerializerInterceptor, response allowlists
        ├── 04-logging.md          # ConsoleLogger, structured JSON logs, trace correlation
        ├── 05-events.md           # @nestjs/event-emitter, wildcards, event readiness
        ├── 06-task-scheduling.md  # @nestjs/schedule, Cron, distributed locks
        ├── 07-queues.md           # @nestjs/bullmq, Redis workers, retry backoff
        ├── 08-http-client.md      # @nestjs/http-client, native fetch, jitter retries
        └── 09-file-storage.md     # Multipart uploads, ParseFilePipe, pre-signed S3 URLs
    └── data/                      # Data persistence, ORMs, and caching
        ├── README.md              # Data guide index
        ├── 01-overview.md         # Database agnosticism, architectural paradigms
        ├── 02-typeorm.md          # @nestjs/typeorm, repositories, relations, QueryRunner
        ├── 03-drizzle.md          # @nestjs/drizzle, Drizzle v1, schema inference, relations
        ├── 04-prisma.md           # PrismaClient, PrismaService, transactions, extensions
        ├── 05-mongodb.md          # @nestjs/mongoose, @Schema, @Prop, subdocuments, sessions
        ├── 06-mikroorm.md         # @mikro-orm/nestjs, Unit of Work, Identity Map, forking
        ├── 07-sequelize.md        # @nestjs/sequelize, sequelize-typescript, models
        └── 08-caching.md          # @nestjs/cache-manager, Keyv, Redis, CacheInterceptor
    └── security/                  # Threat mitigation, auth, and policy enforcement
        ├── README.md              # Security guide index
        ├── 01-authentication.md   # @nestjs/jwt, JwtService, Bearer tokens, @Public
        ├── 02-authorization.md    # RBAC, Claims, CASL abilities, PoliciesGuard
        ├── 03-encryption-hashing.md # AES-256-CTR, bcrypt, argon2, timing attack defense
        ├── 04-security-headers.md # useSecurityHeaders, CSP, HSTS, frame protection
        ├── 05-cors.md             # enableCors, origin allowlists, Fastify method parity
        ├── 06-csrf-protection.md  # Built-in Fetch Metadata CSRF, trusted origins
        └── 07-rate-limiting.md    # @nestjs/throttler, multi-tier limits, Redis storage
    └── http/                      # HTTP protocol, platform adapters, streaming, and performance
        ├── README.md              # HTTP platform guide index
        ├── 01-versioning.md       # URI, Header, Media Type, Custom versioning
        ├── 02-cookies.md          # Native NestJS 12.1+ cookie API, secret rotation
        ├── 03-session.md          # express-session, @fastify/secure-session, Redis
        ├── 04-file-upload-streaming.md # Multipart uploads, FileInterceptor, StreamableFile
        ├── 05-compression.md      # Response compression, Brotli quality, reverse proxies
        ├── 06-server-sent-events.md # SSE streaming, MessageEvent, @SseSignal() cleanup
        ├── 07-mvc.md              # Model-View-Controller, Handlebars templates, layouts
        └── 08-performance-fastify.md # FastifyAdapter, extreme throughput, migration
    └── observability/             # NestJS Observe APM, distributed tracing, and metrics
        ├── README.md              # Observability guide index
        ├── 01-overview.md         # NestJS Observe overview, APM comparison, event metering
        ├── 02-sdk.md              # @nestjs/observe SDK, createObserveModule, Fastify rules
        ├── 03-manual-instrumentation.md # TracerService, custom spans, metrics (counters/gauges)
        ├── 04-distributed-tracing.md # Trace propagation across HTTP, gRPC, and BullMQ queues
        ├── 05-error-monitoring.md # Unhandled exceptions, source context, defect fingerprinting
        ├── 06-dashboard.md        # 3-tier hierarchy, live Service Map, Profiler, SLO burn
        └── 07-mcp-server.md       # Model Context Protocol server, agent diagnostic workflows
    └── reliability/               # Fault tolerance, idempotency, transactional outbox, and locks
        ├── README.md              # Reliability guide index
        ├── 01-resilience.md       # @nestjs/resilience, retry, circuit breaker, bulkhead, fallbacks
        ├── 02-idempotency-keys.md # @nestjs/idempotency, IETF standard, atomic stores, encryption
        ├── 03-transactional-outbox.md # @nestjs/outbox, dual-write prevention, relay, consumer inboxes
        └── 04-distributed-locks.md # @nestjs/locks, cron leases, fencing tokens, leader election
    └── graphql/                   # Type-safe data graphs, Apollo Server v5, Mercurius, federation
        ├── README.md              # GraphQL guide index
        ├── 01-quick-start.md      # Apollo v5 & Mercurius setup, GraphiQL IDE, context factory
        ├── 02-resolvers.md        # Code-first @Resolver, @Query, @ResolveField, pagination
        ├── 03-mutations.md        # @Mutation, @InputType, nested input validation
        ├── 04-subscriptions.md    # Real-time subscriptions, graphql-ws, PubSub, WebSockets auth
        ├── 05-scalars.md          # Custom scalars, Date modes, graphql-type-json
        ├── 06-directives.md       # @Directive, schema transformations with mapSchema
        ├── 07-interfaces.md       # @InterfaceType, polymorphic queries, resolveType
        ├── 08-unions-and-enums.md # createUnionType (as const), registerEnumType
        ├── 09-field-middleware.md # FieldMiddleware, intercepting field resolution
        ├── 10-mapped-types.md     # PartialType, PickType, OmitType, IntersectionType
        ├── 11-plugins.md          # ApolloServerPlugin lifecycle hooks, Mercurius plugins
        ├── 12-complexity.md       # Query complexity analysis, DoS defense, estimators
        ├── 13-extensions.md       # @Extensions, custom field metadata, field-level RBAC
        ├── 14-cli-plugin.md       # AST compiler plugin, automatic @Field, ESM support
        ├── 15-generating-sdl.md   # Headless schema generation with GraphQLSchemaFactory
        ├── 16-sharing-models.md   # graphql-model-shim for frontend browser bundles
        ├── 17-other-features.md   # GqlExecutionContext, guards, custom drivers
        └── 18-federation.md       # Apollo Federation 1 & 2 subgraphs, supergraph gateway
    └── websockets/                # Real-time bidirectional gateways, Socket.IO, and ws
        ├── README.md              # WebSockets guide index & architecture comparison
        ├── 01-gateways.md         # @WebSocketGateway, namespaces, hooks, NestJS 12 scopes
        ├── 02-exception-filters.md # WsException, BaseWsExceptionFilter, cause debugging
        ├── 03-pipes.md            # WsException validation factory, Standard Schema V1
        ├── 04-guards.md           # Handshake auth tokens, RBAC roles, WsAuthGuard
        ├── 05-interceptors.md     # RxJS AOP benchmarking, response envelopes, emit bypass
        └── 06-adapters.md         # WebSocketAdapter, Socket.IO Redis clustering, ws
    └── microservices/             # Distributed message brokers, patterns, and RPC
        ├── README.md              # Microservices architecture & transporter matrix
        ├── 01-overview.md         # Foundations, TCP, @MessagePattern, @EventPattern, ClientProxy
        ├── 02-redis.md            # Redis Pub/Sub, wildcards, dual-connection unwrap
        ├── 03-mqtt.md             # MQTT protocol, QoS 0/1/2, record builders, user properties
        ├── 04-nats.md             # NATS v3 transport-node, queue groups, reply subjects
        ├── 05-rabbitmq.md         # AMQP queues & exchanges, manual acks, topic routing
        ├── 06-kafka.md            # Kafka streaming, reply partitions, NestJS 12 regex patterns
        ├── 07-grpc.md             # Protobuf contracts, @GrpcMethod, streaming, GrpcExceptionFilter
        ├── 08-custom-transporters.md # CustomTransportStrategy, Server, custom ClientProxy
        ├── 09-exception-filters.md # RpcException, observable error streams, hybrid inheritance
        ├── 10-pipes.md            # ValidationPipe with RpcException, Standard Schema Zod
        ├── 11-pre-request-hooks.md # Middleware equivalent, AsyncLocalStorage correlation ID
        ├── 12-guards.md           # Authorization, RpcException, inter-service tokens
        └── 13-interceptors.md     # AOP streams, response envelopes, latency benchmarking
    └── deployment/                # Production release, Docker multi-stage, scaling, and Mau
        ├── README.md              # Production deployment & operations overview
        ├── 01-deployment.md       # Compilation, NODE_ENV, Terminus, logging, Mau on AWS
        ├── 02-docker.md           # Multi-stage Dockerfile (Node 24 + pnpm), dumb-init, non-root
        ├── 03-scaling-clustering.md # Kubernetes HPA, Nginx reverse proxy, ALB, stateless design
        └── 04-health-checks-terminus.md # @nestjs/terminus, liveness/readiness probes, indicators
    └── cli/                       # Developer tooling, project scaffolding, and monorepo builds
        ├── README.md              # CLI architecture & builder comparison overview
        ├── 01-overview.md         # Global vs local binary resolution, ICU check, ESM scaffolding
        ├── 02-workspaces.md       # Monorepo mode, nest-cli.json schema, assets, compilerOptions
        ├── 03-libraries.md        # Monorepo internal libraries, @app/* paths, test runner configs
        ├── 04-usage.md            # Exhaustive CLI command reference, schematics, Mau cloud deploy
        └── 05-scripts.md          # package.json scripts, tsc vs swc vs rspack, legacy migrations
        ├── openapi/                   # OpenAPI (Swagger) API documentation & contract schemas
        │   ├── README.md              # OpenAPI architecture & pipeline overview
        │   ├── 01-introduction.md     # Bootstrap, deferred factory, Fastify, Standard Schema (Zod/Valibot)
        │   ├── 02-types-and-parameters.md # DTO reflection, enumName deduplication, extra models, oneOf
        │   ├── 03-operations.md       # OpenAPI 3.2 hierarchical tags, responses, generic paginated DTOs
        │   ├── 04-security.md         # Bearer, Basic, OAuth2 scopes, API keys, cookie sessions
        │   ├── 05-mapped-types.md     # PartialType, PickType, OmitType, IntersectionType derivation
        │   ├── 06-decorators.md       # Master OpenAPI decorators catalog & applyDecorators composition
        │   ├── 07-cli-plugin.md       # AST compiler plugin, comment introspection, SWC/Jest e2e setup
        │   └── 08-other-features.md   # Multi-specs, explorer dropdown, CI/CD static schema export
        ├── recipes/                   # Enterprise recipes, fast tooling & specialized patterns
        │   ├── README.md              # Recipes architectural taxonomy & enterprise standards
        │   ├── 01-repl.md             # Interactive REPL console, dependency inspection & history
        │   ├── 02-crud-generator.md   # Resource generator for REST, GraphQL, Microservices, WebSockets
        │   ├── 03-swc.md              # High-speed Rust SWC compiler, type checking, circular relations
        │   ├── 04-passport.md         # Passport authentication: Local, JWT, @Public(), GraphQL context
        │   ├── 05-hot-reload.md       # Webpack/Rspack HMR, closePromise port release, EADDRINUSE guard
        │   ├── 06-router-module.md    # Hierarchical module path prefixes & API gateway routing
        │   ├── 07-health-checks.md    # Terminus health probes, memory/disk checks, graceful shutdown
        │   ├── 08-cqrs.md             # CQRS: CommandBus, QueryBus, EventBus, Sagas, Aggregate Roots
        │   ├── 09-serve-static.md     # Serving SPAs, wildcard routing fallthrough, cache control
        │   ├── 10-commander.md        # Standalone CLI tools, @Command, CommandRunner, CommandTestFactory
        │   └── 11-async-local-storage.md # AsyncLocalStorage, @nestjs/observe TracerService, nestjs-cls
        └── faq/                       # Runtime FAQs, edge cases, transports & troubleshooting
            ├── README.md              # FAQ architecture taxonomy & operational standards
            ├── 01-serverless.md       # Serverless execution, cold starts, bundling benchmarks, Lambda
            ├── 02-http-adapter.md     # HTTP adapter pattern, HttpAdapterHost, native Express/Fastify
            ├── 03-keep-alive-connections.md # forceCloseConnections, Keep-Alive sockets, graceful exit
            ├── 04-global-prefix.md    # Global path prefix, route exclusions, path-to-regexp wildcards
            ├── 05-raw-body.md         # Raw body buffers, webhook HMAC signature verification
            ├── 06-hybrid-application.md # Hybrid HTTP + Microservices, inheritAppConfig, lifecycle
            ├── 07-multiple-servers.md # Dual-port HTTP/HTTPS binding, Fastify TLS, ShutdownObserver
            ├── 08-request-lifecycle.md # Request lifecycle: Middleware -> Guard -> Interceptor -> Pipe -> Filter
            ├── 09-common-errors.md    # Cannot resolve dependency, circular DI, NEST_DEBUG, watch loops
            └── 10-examples.md         # Official sample repositories catalog & architectural archetypes
```

---

## Architectural Principles

1. **Explicit Boundaries**: Deployable services live in `apps/*`; reusable business contracts and schemas live in `packages/*`.
2. **Single Source of Truth**: Shared domain models and validation schemas originate in `@araz/contracts` and are consumed across frontend and backend.
3. **Type-Safe Inversion of Control**: The backend leverages NestJS's dependency injection system with strict compile-time types and explicit runtime tokens.
4. **Deterministic Execution Pipeline**: All incoming requests traverse an explicit pipeline: `Middleware -> Guards -> Interceptors (Pre) -> Pipes -> Handler -> Interceptors (Post) -> Exception Filters`.
5. **Modern ESM Compliance**: All backend modules operate under ECMAScript Modules (`NodeNext`) with explicit relative import specifiers.

---

## Quick Navigation

* **Backend Standards Index**: [docs/backend/README.md](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/README.md)
* **Request Lifecycle Reference**: [docs/backend/11-request-lifecycle.md](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/11-request-lifecycle.md)
* **Root Application Guide**: [README.md](file:///home/solo/JUNK/OFC/LK/araz/README.md)
* **API Service Guide**: [apps/api/README.md](file:///home/solo/JUNK/OFC/LK/araz/apps/api/README.md)

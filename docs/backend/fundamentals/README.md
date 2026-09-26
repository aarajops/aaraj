# NestJS Fundamentals & Advanced Architecture

> **Source Reference**: [NestJS Official Documentation - Fundamentals](https://docs.nestjs.com/fundamentals/custom-providers)

While the [Overview guides](../README.md) cover standard components (controllers, providers, modules, middleware, pipes, guards, interceptors), building complex enterprise applications requires the advanced features of the NestJS runtime system.

This section covers the deep architectural mechanisms of the Nest Inversion of Control (IoC) container, execution contexts, dynamic modules, lifecycle management, and testing infrastructure.

---

## Fundamentals Table of Contents

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

## Architectural Principles for `@araz/api`

1. **Explicit Tokens over Erased Types**: Always use `Symbol()` or abstract classes as injection tokens for decoupled contracts.
2. **Deterministic Startup**: Use asynchronous providers to guarantee external resources (database, cache) are healthy before accepting traffic.
3. **Singleton Default (`Scope.DEFAULT`)**: Never introduce request-scoped providers unless required for isolated multi-tenant data sources.
4. **Resilient Testing**: Every module must support isolated unit testing and clean Supertest E2E overrides without monkey-patching.

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
    └── 11-request-lifecycle.md    # Deterministic end-to-end request execution pipeline
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

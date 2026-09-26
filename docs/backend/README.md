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

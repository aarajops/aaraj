# NestJS Core Architecture & Overview Standards

> **Domain**: Core Building Blocks, Inversion of Control & Ingress Pipeline  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The **Overview** tier documents the foundational architectural primitives of NestJS. These eleven core building blocks form the backbone of all backend services across the monorepo, providing an expressive, modular, and strongly-typed architecture based on Dependency Injection (DI) and Aspect-Oriented Programming (AOP).

```text
                           NESTJS CORE ARCHITECTURE
                                       │
      ┌────────────────────────────────┼────────────────────────────────┐
      ▼                                ▼                                ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  Ingress Layer   │          │  Domain & IoC    │          │ Enhancers & AOP  │
├──────────────────┤          ├──────────────────┤          ├──────────────────┤
│ • First Steps    │          │ • Providers & DI │          │ • Middleware     │
│ • Controllers    │          │ • Feature Modules│          │ • Guards (Auth)  │
│ • Custom         │          │ • Platform       │          │ • Interceptors   │
│   Decorators     │          │   Adapters       │          │ • Pipes (Schema) │
│                  │          │                  │          │ • Exception Fltrs│
│                  │          │                  │          │ • Req Lifecycle  │
└──────────────────┘          └──────────────────┘          └──────────────────┘
```

---

## 1. Overview Architectural Taxonomy

| Chapter | Building Block | Primary Purpose | Enterprise Production Focus |
| :--- | :--- | :--- | :--- |
| **[01 - First Steps](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/01-first-steps.md)** | Application Bootstrap | `NestFactory.create()`, platform adapters (Express vs. Fastify), pure ESM compliance. | Setting up deterministic bootstrap sequences, configuring global prefixes, and adhering to Node 24 ESM import standards. |
| **[02 - Controllers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/02-controllers.md)** | Routing & Request Ingress | `@Controller()`, HTTP verbs (`@Get`, `@Post`), `@Param`, `@Query`, `@Body`, status codes. | Receiving HTTP requests, validating payloads via DTOs, and delegating business logic to domain services. |
| **[03 - Providers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/03-providers.md)** | Business Logic & DI | `@Injectable()`, constructor dependency injection, token resolution, injection scopes. | Encapsulating persistence, domain algorithms, third-party integrations, and singleton lifecycle management. |
| **[04 - Modules](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/04-modules.md)** | Encapsulation Boundaries | `@Module()`, `providers`, `controllers`, `imports`, `exports`, global modules (`@Global`). | Establishing clear architectural boundaries, encapsulating feature state, and managing provider reusability. |
| **[05 - Middleware](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/05-middleware.md)** | Pre-Routing Pipeline | `NestMiddleware`, `MiddlewareConsumer`, route exclusion, request logging, headers. | Intercepting requests before route selection for low-level protocol logging, header manipulation, and tracing. |
| **[06 - Exception Filters](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/06-exception-filters.md)** | Error Handling Layer | `HttpException`, `@Catch()`, custom filters, machine-readable `errorCode` properties. | Catching unhandled exceptions, formatting uniform JSON error responses, and preventing sensitive stack leaks. |
| **[07 - Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/07-pipes.md)** | Validation & Transformation | `PipeTransform`, `StandardSchemaValidationPipe`, Zod schemas, type coercion. | Validating incoming query, param, and body inputs against contract schemas before handlers execute. |
| **[08 - Guards](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/08-guards.md)** | Authentication & RBAC | `CanActivate`, `@UseGuards()`, `Reflector`, role-based access control (RBAC). | Determining whether a request is authorized to proceed based on JWT tokens, permissions, or session state. |
| **[09 - Interceptors](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/09-interceptors.md)** | Aspect-Oriented Streams | `NestInterceptor`, `CallHandler`, RxJS operators (`map`, `catchError`, `timeout`). | Binding extra logic before/after method execution, transforming response payloads, and handling timeouts. |
| **[10 - Custom Decorators](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/10-custom-decorators.md)** | Metadata & Composition | `createParamDecorator()`, `applyDecorators()`, declarative parameter injection. | Extracting user sessions (`@CurrentUser()`), validating tokens, and bundling complex decorator sets. |
| **[11 - Request Lifecycle](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/overview/11-request-lifecycle.md)** | Execution Pipeline | End-to-end execution order, timing guarantees, scope interactions. | Understanding deterministic phase traversal, middleware traps, and interceptor stream sequencing. |

---

## 2. Ingress & Enhancer Execution Sequence

When an HTTP request enters the NestJS application, it traverses the core building blocks in an explicit, deterministic sequence:

```text
Incoming Request
      │
      ▼
1. Middleware (Pre-Routing: Logging, Headers, Tracing)
      │
      ▼
2. Guards (Authentication & Authorization: CanActivate)
      │
      ▼
3. Interceptors Pre-Controller (Context binding, audit spans)
      │
      ▼
4. Pipes (Validation & Transformation: Zod / DTOs)
      │
      ▼
5. Controller Handler ➔ Service Logic (Business Processing)
      │
      ▼
6. Interceptors Post-Request (Response wrapping, RxJS map / catchError)
      │
      ▼
7. Exception Filters (Only invoked if an unhandled error occurs)
      │
      ▼
Outgoing Server Response
```

# 11 - Request-Response Lifecycle

This document details the exact, deterministic execution order of the NestJS request-response lifecycle. Understanding this sequence is vital for architecting secure, predictable enterprise backends.

---

## 1. End-to-End Execution Sequence

```text
Incoming HTTP Request
  │
  ▼
[PHASE 1: MIDDLEWARE]
  ├─ 1. Global Middleware (app.use or AppModule)
  └─ 2. Module Middleware (consumer.apply().forRoutes())
  │
  ▼
[PHASE 2: GUARDS (CanActivate)]
  ├─ 3. Global Guards (APP_GUARD / useGlobalGuards)
  ├─ 4. Controller Guards (@UseGuards on Class)
  └─ 5. Route / Method Guards (@UseGuards on Method)
  │   (Throws 403 ForbiddenException if any guard returns false)
  ▼
[PHASE 3: INTERCEPTORS (Pre-Handler Pointcut)]
  ├─ 6. Global Interceptors (APP_INTERCEPTOR)
  ├─ 7. Controller Interceptors (@UseInterceptors on Class)
  └─ 8. Route Interceptors (@UseInterceptors on Method)
  │   (Executes logic BEFORE next.handle())
  ▼
[PHASE 4: PIPES (Transformation & Validation)]
  ├─ 9. Global Pipes (APP_PIPE)
  ├─ 10. Controller Pipes (@UsePipes on Class)
  ├─ 11. Route Pipes (@UsePipes on Method)
  └─ 12. Parameter-Level Pipes (@Body(Pipe), @Param(Pipe))
  │   (Halts execution if validation fails, throws BadRequestException)
  ▼
[PHASE 5: ROUTE HANDLER INVOCATION]
  └─ 13. Controller Action Method & Injected Service Providers
  │
  ▼
[PHASE 6: INTERCEPTORS (Post-Handler Stream Manipulation)]
  ├─ 14. Route Interceptors (RxJS stream: tap, map)
  ├─ 15. Controller Interceptors
  └─ 16. Global Interceptors
  │
  ▼
[PHASE 7: EXCEPTION FILTERS (If Exception Thrown Anywhere Above)]
  ├─ 17. Route Exception Filters (@UseFilters on Method)
  ├─ 18. Controller Exception Filters (@UseFilters on Class)
  └─ 19. Global Exception Filters (APP_FILTER / useGlobalFilters)
  │
  ▼
Outgoing HTTP Response
```

---

## 2. Component Decision Matrix: When to Use What

| Requirement | Correct Component | Reason |
| :--- | :--- | :--- |
| CORS, Helmet security headers, Body parsing | **Middleware** | Low-level HTTP processing before routing occurs. |
| Extracting correlation IDs, request tracing | **Middleware** | Must execute before any guards or handlers. |
| Authentication & Bearer token verification | **Guards** | Fast exit if unauthenticated; aware of execution context. |
| Role-Based Access Control (RBAC), Permissions | **Guards** | Reads route metadata via `Reflector`. |
| Execution time logging / Metrics | **Interceptors** | Wraps the entire handler execution with `tap()`. |
| Response envelope wrapping (`{ data, timestamp }`) | **Interceptors** | Transforms returned output stream with `map()`. |
| Caching endpoint responses | **Interceptors** | Can override execution with `of()` without touching the controller. |
| String-to-number / Date / UUID conversion | **Pipes** | Transforms parameters right before handler receives them. |
| Request payload validation (Zod / Contracts) | **Pipes** | Validates DTOs at the boundary and rejects invalid input. |
| Formatting error responses, concealing server details| **Exception Filters**| Centralized error translation and status code mapping. |

---

## 3. Scope & Error Traps to Avoid

### 1. The Middleware Exception Trap
* **Problem**: Middleware runs **before** the router selects a controller or method.
* **Consequence**: Method-scoped and controller-scoped `@UseFilters()` **do not catch** exceptions thrown in middleware. Only **global** exception filters catch middleware errors.

### 2. Guard Timing vs. Pipes
* Guards execute **before** pipes.
* Do not attempt to validate incoming request bodies inside a guard. If a payload is malformed, the guard should not crash; let the **Validation Pipe** handle payload shape verification.

### 3. Library-Specific Response Mode (`@Res()`)
* If a controller method injects `@Res()` without `{ passthrough: true }`, interceptor post-processing (`map()`) and declarative status codes (`@HttpCode()`) are bypassed.
* **Standard**: Always prefer declarative return values or use `@Res({ passthrough: true })`.

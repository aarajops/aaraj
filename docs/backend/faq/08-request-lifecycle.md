# Request Lifecycle & Pipeline Execution Order

> **Domain**: Execution Flow, Interceptor Observables & Filter Resolution  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

The NestJS **Request Lifecycle** defines the deterministic sequence through which every incoming HTTP request traverses middleware, security guards, interceptors, validation pipes, route handlers, and exception filters.

Understanding the precise execution and binding order prevents subtle security bypasses, unexpected data mutations, and unhandled exception leaks.

```text
 1. Incoming Request
        │
        ▼
 2. Middleware Execution (Global ➔ Module-bound in import graph order)
        │
        ▼
 3. Guards Evaluation (Global ➔ Controller ➔ Route)
        │
        ▼
 4. Interceptors Pre-Controller (Global ➔ Controller ➔ Route)
        │
        ▼
 5. Pipes Transformation & Validation (Global ➔ Controller ➔ Route ➔ Param reverse order)
        │
        ▼
 6. Controller Route Handler & Service Logic
        │
        ▼
 7. Interceptors Post-Request (Route ➔ Controller ➔ Global [RxJS Pipe])
        │
        ▼
 8. Exception Filters (Route ➔ Controller ➔ Global [Lowest Level First])
        │
        ▼
 9. Outgoing Response
```

---

## 1. Execution Order by Pipeline Phase

### Phase 1: Middleware
Runs prior to route selection and handler matching.
1. **Globally bound middleware** (`app.use()`).
2. **Module-bound middleware**:
   - Middleware registered in global modules (`@Global()`).
   - Middleware registered in the root module (`AppModule`).
   - Middleware registered in imported feature modules, sequenced by their distance from the root in the DI dependency graph.

### Phase 2: Guards
Evaluate authorization and access rights. A single `false` halts the pipeline and throws `403 Forbidden`.
1. **Global Guards** (`APP_GUARD` or `app.useGlobalGuards()`).
2. **Controller Guards** (`@UseGuards()` on class).
3. **Route Guards** (`@UseGuards()` on method).

### Phase 3: Interceptors (Pre-Controller)
Set up context, audit spans, or mutate request arguments before route handler execution:
1. **Global Interceptors** (`APP_INTERCEPTOR` or `app.useGlobalInterceptors()`).
2. **Controller Interceptors** (`@UseInterceptors()` on class).
3. **Route Interceptors** (`@UseInterceptors()` on method).

### Phase 4: Pipes
Perform validation and type casting on route inputs.
1. **Global Pipes** (`APP_PIPE` or `app.useGlobalPipes()`).
2. **Controller Pipes** (`@UsePipes()` on class).
3. **Route Pipes** (`@UsePipes()` on method).
4. **Parameter-Level Pipes**: Evaluated in **reverse parameter order** (from right to left: last parameter first, first parameter last).

```typescript
@Patch(':id')
update(
  @Body() body: UpdateDto,     // Evaluated 3rd
  @Param() params: ParamsDto,  // Evaluated 2nd
  @Query() query: QueryDto,    // Evaluated 1st
) {}
```

### Phase 5: Controller & Services
The underlying route handler method executes business logic, calls domain services, and returns a value or Promise.

### Phase 6: Interceptors (Post-Request)
Interceptors return RxJS Observables. Because observables resolve in reverse order (LIFO), the post-response transformation pipeline flows inside-out:
1. **Route Interceptors** (innermost).
2. **Controller Interceptors**.
3. **Global Interceptors** (outermost).

### Phase 7: Exception Filters
Unlike all other enhancers, Exception Filters resolve from the **lowest level possible**:
1. **Route-Level Filters** (`@UseFilters()` on method).
2. **Controller-Level Filters** (`@UseFilters()` on class).
3. **Global Filters** (`APP_FILTER` or `app.useGlobalFilters()`).

> **Rule**: An exception caught by a route-level filter is consumed and will **never** bubble up to controller or global filters unless explicitly re-thrown. Exceptions thrown inside middleware can **only** be intercepted by global filters because route-level handlers have not yet been selected.

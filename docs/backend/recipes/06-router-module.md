# Router Module & Hierarchical Routing

> **Domain**: HTTP Route Path Namespacing & Hierarchical Module Trees  
> **Source Reference**: [NestJS Router Module Recipe](https://docs.nestjs.com/recipes/router-module)  
> **Package**: `@nestjs/core` (`RouterModule`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In standard NestJS HTTP routing, an endpoint's URI is determined by concatenating the global prefix (e.g. `/api`), the controller path prefix in `@Controller('users')`, and the method path in `@Get(':id')`. 

When designing complex modular applications—such as administrative control panels, multi-tenant sub-APIs, or versioned platform modules—repeating identical path prefixes across dozens of individual controllers is error-prone. The `RouterModule` allows declaring route prefixes at the **module level**, including recursive parent-child hierarchies.

---

## 1. Module-Level Route Registration

To attach a uniform route prefix to all controllers declared within a feature module, register the module with `RouterModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { DashboardModule } from './dashboard/dashboard.module.js';

@Module({
  imports: [
    DashboardModule,
    RouterModule.register([
      {
        path: 'dashboard',
        module: DashboardModule,
      },
    ]),
  ],
})
export class AppModule {}
```

Every controller encapsulated inside `DashboardModule` automatically inherits the `/dashboard` prefix:
- A controller with `@Controller('stats')` resolves to `GET /dashboard/stats`.
- A controller with `@Controller('users')` resolves to `GET /dashboard/users`.

---

## 2. Hierarchical Parent-Child Module Trees

`RouterModule` supports nested module structures using the `children` array. Child modules inherit their parent's route prefix recursively:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { DashboardModule } from './admin/dashboard/dashboard.module.js';
import { MetricsModule } from './admin/metrics/metrics.module.js';

@Module({
  imports: [
    AdminModule,
    DashboardModule,
    MetricsModule,
    RouterModule.register([
      {
        path: 'admin',
        module: AdminModule,
        children: [
          {
            path: 'dashboard',
            module: DashboardModule,
          },
          {
            path: 'metrics',
            module: MetricsModule,
          },
        ],
      },
    ]),
  ],
})
export class AppModule {}
```

### Route Resolution Mapping

| Controller Class | Declared Module | `@Controller()` Path | Final Resolved Endpoint |
| :--- | :--- | :--- | :--- |
| `AdminAuthController` | `AdminModule` | `'auth'` | `/admin/auth` |
| `DashboardOverviewController` | `DashboardModule` | `'overview'` | `/admin/dashboard/overview` |
| `SystemMetricsController` | `MetricsModule` | `'system'` | `/admin/metrics/system` |

---

## 3. Architectural Guidelines

- **Keep Hierarchies Shallow**: While `RouterModule` supports arbitrary nesting depth, limit hierarchies to 2–3 levels (e.g. `/v1/admin/billing`). Excessive nesting makes route traceability difficult.
- **Do Not Duplicate Controller Names**: When using `RouterModule`, keep the `@Controller()` decorator paths focused on the entity (e.g. `@Controller('users')` rather than `@Controller('admin-users')`).
- **Scoped to HTTP**: `RouterModule` applies exclusively to HTTP transports (Express and Fastify). It has no effect on microservices, WebSocket gateways, or gRPC endpoints.

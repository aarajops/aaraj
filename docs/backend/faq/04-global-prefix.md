# Global Path Prefix & Route Exclusions

> **Domain**: HTTP Routing Topography, API Gateway Paths & URL Rewriting  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In enterprise RESTful APIs, routing paths are typically organized under an overarching namespace, such as `/api` or `/v1`. Instead of prefixing every controller decorator (`@Controller('api/v1/users')`), NestJS provides `app.setGlobalPrefix()`.

---

## 1. Setting Global Route Prefixes

Invoke `setGlobalPrefix()` on the `INestApplication` instance in `src/main.ts` prior to `app.listen()`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefixes all controller routes: /users -> /api/v1/users
  app.setGlobalPrefix('api/v1');

  await app.listen(3000);
}
await bootstrap();
```

---

## 2. Route Exclusions (`exclude`)

Certain routes must be accessible at the root level without the global prefix—most notably **Kubernetes health/liveness probes** (`/health`), **OAuth redirect callbacks** (`/oauth/callback`), or **webhook receivers** (`/webhooks/stripe`).

Use the `exclude` option to bypass the global prefix:

```typescript
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1', {
    exclude: [
      // 1. Exclude specific HTTP method and route
      { path: 'health', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },

      // 2. Exclude route across ALL HTTP methods (string syntax)
      'webhooks/stripe',
    ],
  });

  await app.listen(3000);
}
await bootstrap();
```

---

## 3. Modern Wildcard Rules (`path-to-regexp`)

Under the hood, route exclusion matching utilizes the `path-to-regexp` library. Note the following critical syntactical rules:

> **Important**: Bare asterisks (`*`) are **deprecated** in modern path matching. You must use explicit parameters (`:param`) or named wildcards (`*splat`).

### The Sub-Segment Matching Rule

1. **`health/*splat`**: Excludes nested sub-paths like `/health/liveness` or `/health/db`, but **does NOT** match `/health` itself (requires at least one segment after `/health/`).
2. **`health/{*splat}`**: By wrapping the wildcard in braces, both `/health` and all nested sub-paths (`/health/liveness`) are matched and excluded simultaneously.

```typescript
app.setGlobalPrefix('api/v1', {
  exclude: [
    // Matches /public and /public/assets/logo.png
    'public/{*splat}',

    // Matches /docs/en but NOT /docs
    'docs/*lang',
  ],
});
```

---

## 4. Architecture Interaction: Global Prefix vs. Versioning vs. RouterModule

When combining global prefixes with [Versioning](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/http/01-versioning.md) and [RouterModule](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/recipes/06-router-module.md), the final URI path is resolved hierarchically:

```text
Full URI Path = [Global Prefix] / [Version Prefix] / [Module Prefix] / [Controller Path] / [Route Method Path]

Example:
  Global Prefix:    /api
  Version Prefix:   /v2
  RouterModule:     /admin
  Controller:       /users
  Method:           /:id

  Resulting Route:  /api/v2/admin/users/:id
```

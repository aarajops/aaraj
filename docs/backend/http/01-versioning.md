# 01 - Versioning

> **Source Reference**: [NestJS Official Documentation - Versioning](https://docs.nestjs.com/http/versioning)

API Versioning allows multiple versions of controllers or individual route handlers to coexist within the same application. In production systems, client applications (web SPAs, mobile applications, third-party webhook consumers) evolve at different rates. Versioning provides a stable contract that accommodates breaking changes without disrupting existing consumers.

NestJS supports four distinct versioning strategies: **URI Versioning**, **Header Versioning**, **Media Type Versioning**, and **Custom Versioning**.

---

## 1. Enabling Versioning

Versioning is configured globally during application bootstrap using the `enableVersioning()` method on the application instance.

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableVersioning({
    type: VersioningType.URI,
  });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

---

## 2. Versioning Strategies

### 2.1. URI Versioning (`VersioningType.URI`)

The version is passed directly in the request path, e.g., `https://api.example.com/v1/users` and `https://api.example.com/v2/users`.

```typescript
app.enableVersioning({
  type: VersioningType.URI,
  prefix: 'v', // Default is 'v'. Set to false to disable prefix (e.g. /1/users)
});
```

> [!NOTE]
> When combined with a global prefix (e.g. `app.setGlobalPrefix('api')`), the version is inserted **after** the global prefix and **before** the controller route:
> `/api/v1/users`

### 2.2. Header Versioning (`VersioningType.HEADER`)

The version is specified via a custom HTTP request header.

```typescript
app.enableVersioning({
  type: VersioningType.HEADER,
  header: 'X-Api-Version',
});
```

*Example Client Request*:
```http
GET /users HTTP/1.1
Host: api.example.com
X-Api-Version: 2
```

### 2.3. Media Type Versioning (`VersioningType.MEDIA_TYPE`)

The version is specified inside the `Accept` header separated by a semicolon (`;`) and a key prefix.

```typescript
app.enableVersioning({
  type: VersioningType.MEDIA_TYPE,
  key: 'v=',
});
```

*Example Client Request*:
```http
GET /users HTTP/1.1
Host: api.example.com
Accept: application/json;v=2
```

### 2.4. Custom Versioning (`VersioningType.CUSTOM`)

Custom versioning uses an extractor function that inspects any property of the incoming request (such as subdomains, query params, or multiple headers) and returns a version string or sorted array of strings.

```typescript
import { VersioningType } from '@nestjs/common';
import type { Request } from 'express';

const customExtractor = (request: Request): string | string[] => {
  // Extract version from query param or custom header
  const version = request.query['version'] || request.headers['x-client-version'];
  return typeof version === 'string' ? version : '';
};

app.enableVersioning({
  type: VersioningType.CUSTOM,
  extractor: customExtractor,
});
```

> [!WARNING]
> **Express Adapter Limitation**: When using Express, the extractor should return a **single version** (string or single-element array). Selecting the highest matching version from a multi-element array (e.g., `['3', '2', '1']`) does not work reliably in Express due to router design limitations. For multi-version fallback negotiation, use the **Fastify** adapter.

---

## 3. Applying Versions to Controllers & Routes

### Controller-Level Versioning

Specifying a version on `@Controller()` applies it to all route handlers inside that controller:

```typescript
// src/users/v1/users-v1.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller({
  path: 'users',
  version: '1',
})
export class UsersV1Controller {
  @Get()
  findAll() {
    return [{ id: 'usr_1', name: 'Legacy User Schema' }];
  }
}
```

### Route-Level Versioning

Use the `@Version()` decorator on individual methods to override the controller version or define side-by-side handlers within a single controller:

```typescript
// src/users/users.controller.ts
import { Controller, Get, Version } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Version('1')
  @Get()
  findAllV1() {
    return [{ id: 'usr_1', name: 'Alice', fullName: 'Alice Smith' }];
  }

  @Version('2')
  @Get()
  findAllV2() {
    return [{ id: 'usr_1', firstName: 'Alice', lastName: 'Smith' }];
  }
}
```

### Multiple Versions per Route / Controller

An array of versions can be provided when a route handler remains unchanged across multiple versions:

```typescript
@Controller('users')
export class UsersController {
  @Version(['1', '2'])
  @Get('status')
  getStatus() {
    return { status: 'operational' };
  }
}
```

### Version Neutral (`VERSION_NEUTRAL`)

For endpoints that should respond identically regardless of what version is requested (or when no version is provided at all), use `VERSION_NEUTRAL`:

```typescript
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  @Get()
  checkHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

> [!NOTE]
> With URI Versioning, a `VERSION_NEUTRAL` resource is accessed directly without any version prefix in its path (e.g., `/api/health`).

---

## 4. Global Default Version

To avoid decorating every controller or to provide a fallback version for routes without an explicit version, configure `defaultVersion`:

```typescript
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: '1',
  // or: defaultVersion: ['1', '2'],
  // or: defaultVersion: VERSION_NEUTRAL,
});
```

> [!WARNING]
> If versioning is enabled and a route has no version decorator, no global default version is set, and a version is passed in the request, NestJS returns **404 Not Found**.

---

## 5. Middleware Versioning

Middleware can target specific route versions using the route configuration object in `MiddlewareConsumer.forRoutes()`:

```typescript
// src/app.module.ts
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { V2DeprecationHeaderMiddleware } from './common/middleware/v2-deprecation.middleware.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [UsersModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(V2DeprecationHeaderMiddleware)
      .forRoutes({
        path: 'users',
        method: RequestMethod.GET,
        version: '1',
      });
  }
}
```

---

## 6. Monorepo Production Guidelines

1. **Standardize on URI Versioning for Public APIs**: URI versioning (`/api/v1/resource`) is transparent, human-readable, cacheable by CDNs without complex `Vary` headers, and directly linkable.
2. **Dedicated Versioned Controllers**: Rather than scattering `@Version('1')` and `@Version('2')` across individual methods within the same class, create dedicated controllers (`users-v1.controller.ts` vs `users-v2.controller.ts`). This keeps DTOs and serialization transforms cleanly isolated.
3. **Contract Alignment**: In `@aaraj`, API contracts in `packages/contracts` should export distinct types per version (e.g., `UserV1Dto` vs `UserV2Dto`) to prevent regressions across web and mobile consumers.

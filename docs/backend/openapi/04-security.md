# Security Schemes & Authentication

> **Domain**: OpenAPI Security Requirements, OAuth2 & Token Authentication  
> **Source Reference**: [NestJS OpenAPI Security](https://docs.nestjs.com/openapi/security)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Security definitions declare which authentication mechanisms and token formats are required to access API paths and operations. NestJS allows defining security schemes centrally on the base OpenAPI document using `DocumentBuilder`, then enforcing them across controllers and methods with `@ApiSecurity()` or built-in authentication decorators.

---

## 1. Security Architecture & DocumentBuilder Registration

Before applying security decorators to controllers, register the corresponding security definitions in `main.ts` using `DocumentBuilder`:

```typescript
// apps/api/src/main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Aaraj Enterprise API')
  .setVersion('1.0.0')
  // 1. JWT Bearer Token (Authorization: Bearer <token>)
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Input your valid JSON Web Token',
    },
    'JWT-auth', // Token name
  )
  // 2. HTTP Basic Authentication
  .addBasicAuth(
    {
      type: 'http',
      scheme: 'basic',
      description: 'Username and password for service-to-service calls',
    },
    'Basic-auth',
  )
  // 3. API Key via Header
  .addApiKey(
    {
      type: 'apiKey',
      name: 'X-API-KEY',
      in: 'header',
      description: 'Partner API key authorization',
    },
    'api-key',
  )
  // 4. Cookie Authentication
  .addCookieAuth('session_id')
  // 5. OAuth2 Authorization Code Flow
  .addOAuth2({
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://auth.aaraj.io/oauth2/authorize',
        tokenUrl: 'https://auth.aaraj.io/oauth2/token',
        scopes: {
          'read:users': 'Read user accounts',
          'write:users': 'Modify user accounts',
        },
      },
    },
  })
  .build();
```

---

## 2. Authentication Decorator Reference

| Authentication Type | Base Registration | Controller / Route Decorator |
| :--- | :--- | :--- |
| **JWT Bearer** | `.addBearerAuth()` | `@ApiBearerAuth()` |
| **HTTP Basic** | `.addBasicAuth()` | `@ApiBasicAuth()` |
| **API Key / Custom** | `.addApiKey()` / `.addSecurity()` | `@ApiSecurity('security-name')` |
| **Cookie Session** | `.addCookieAuth('cookie-name')`| `@ApiCookieAuth()` |
| **OAuth2 Scopes** | `.addOAuth2()` | `@ApiOAuth2(['scope1', 'scope2'])` |

---

## 3. Applying Security to Controllers and Routes

### Controller-Level Enforcement

Applying an authentication decorator at the class level enforces the security requirement across all endpoints within that controller:

```typescript
// apps/api/src/users/users.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Invalid or missing Bearer token' })
@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  @Get('profile')
  getProfile() {
    return { id: 1, name: 'Alice' };
  }
}
```

### Route-Level Overrides & Multi-Scheme Operations

An endpoint can combine multiple security schemes (e.g. allowing either Bearer token or API key) or specify fine-grained OAuth2 scopes:

```typescript
// apps/api/src/orders/orders.controller.ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiSecurity, ApiTags } from '@nestjs/swagger';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  @Post()
  @ApiOAuth2(['write:orders'])
  @ApiSecurity('api-key')
  createOrder() {
    return { status: 'created' };
  }
}
```

---

## 4. Documenting Public Routes in Protected Controllers

If a controller is secured by default, but a specific route should be publicly accessible (e.g. `GET /products` in a catalog controller), omit the security decorator from the route or declare security as empty:

```typescript
import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  // Publicly readable endpoint:
  @Get()
  @ApiSecurity({}) // Explicitly removes security requirement in OpenAPI
  findAll() {
    return [];
  }

  // Protected mutation endpoint:
  @Post()
  create() {
    return { id: 1 };
  }
}
```

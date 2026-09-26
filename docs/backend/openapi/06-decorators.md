# OpenAPI Decorators Reference

> **Domain**: OpenAPI Metadata Decorators & Reflection Modifiers  
> **Source Reference**: [NestJS OpenAPI Decorators](https://docs.nestjs.com/openapi/decorators)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

All OpenAPI decorators exported by `@nestjs/swagger` are prefixed with `@Api` to distinguish them from core framework decorators. This catalog details every decorator, its allowed application targets, and common architectural use cases.

---

## 1. Master Decorators Reference Catalog

| Decorator | Application Target | Description |
| :--- | :--- | :--- |
| `@ApiBasicAuth(name?)` | Method / Controller | Enforces HTTP Basic authentication requirement. |
| `@ApiBearerAuth(name?)` | Method / Controller | Enforces JWT Bearer token authentication requirement. |
| `@ApiBody(options)` | Method | Defines request body payload schema, type, and examples. |
| `@ApiConsumes(...mimeTypes)` | Method / Controller | Declares accepted MIME types (e.g. `'multipart/form-data'`). |
| `@ApiCookieAuth(name?)` | Method / Controller | Enforces cookie-based session token requirement. |
| `@ApiExcludeController()` | Controller | Excludes an entire controller from the generated specification. |
| `@ApiExcludeEndpoint()` | Method | Excludes an individual route handler from the specification. |
| `@ApiExtension(name, value)` | Method / Controller | Attaches custom `x-*` OpenAPI vendor extensions. |
| `@ApiExtraModels(...models)` | Method / Controller / Model | Registers additional model classes for schema inspection. |
| `@ApiHeader(options)` | Method / Controller | Documents expected HTTP request header. |
| `@ApiHeaders(headers[])` | Method / Controller | Documents an array of expected HTTP request headers. |
| `@ApiHideProperty()` | Model Property | Prevents a specific class property from appearing in schemas. |
| `@ApiIncludeEndpoint()` | Method | Selectively includes endpoint when `onlyIncludeDecoratedEndpoints` is enabled. |
| `@ApiLink(options)` | Method | Declares OpenAPI runtime links between operations. |
| `@ApiOAuth2(scopes[], name?)`| Method / Controller | Enforces OAuth2 authentication with required scopes. |
| `@ApiOperation(options)` | Method | Defines summary, description, deprecated status, and operationId. |
| `@ApiParam(options)` | Method / Controller | Documents path parameter (`:id`) type, description, and enum. |
| `@ApiProduces(...mimeTypes)` | Method / Controller | Declares response MIME types (e.g. `'application/json'`). |
| `@ApiProperty(options?)` | Model Property | Explicitly exposes a property, its constraints, type, and example. |
| `@ApiPropertyOptional(options?)` | Model Property | Shorthand for `@ApiProperty({ required: false })`. |
| `@ApiQuery(options)` | Method / Controller | Documents query string parameter name, type, and optionality. |
| `@ApiResponse(options)` | Method / Controller | Defines HTTP response status, description, headers, and schema. |
| `@ApiResponseProperty(options?)` | Model Property | Special property decorator for response models with read-only semantics. |
| `@ApiSchema(options)` | Model Class | Customizes generated schema name and top-level description. |
| `@ApiSecurity(name, scopes?)` | Method / Controller | Attaches a declared security scheme requirement. |
| `@ApiTags(...tags)` | Method / Controller | Groups routes under designated tags. |
| `@ApiCallbacks(callbacks)` | Method / Controller | Documents asynchronous event callbacks. |
| `@ApiWebhook(name, options?)`| Method | Documents OpenAPI 3.1+ inbound webhooks. |

---

## 2. Decorator Composition Pattern (`applyDecorators`)

When multiple endpoints share identical documentation attributes (e.g., standard error responses, security schemes, and rate limit headers), eliminate boilerplate using Nest's `applyDecorators`:

```typescript
// apps/api/src/common/decorators/api-auth-endpoint.decorator.ts
import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

export function ApiAuthEndpoint(summary: string) {
  return applyDecorators(
    ApiBearerAuth('JWT-auth'),
    ApiOperation({ summary }),
    ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' }),
    ApiForbiddenResponse({ description: 'User lacks required role permissions' }),
  );
}
```

```typescript
// apps/api/src/users/users.controller.ts
@Get('me')
@ApiAuthEndpoint('Fetch the authenticated caller profile')
getProfile(@CurrentUser() user: UserSession) {
  return user;
}
```

# 10 - Custom Decorators

> **Source Reference**: [NestJS Official Documentation - Custom Decorators](https://docs.nestjs.com/custom-decorators)

Nest is built around TypeScript decorators. Decorators allow you to attach metadata, transform parameters, or bind guards and interceptors declaratively.

---

## 1. Built-in Parameter Decorators

Nest provides built-in parameter decorators that map to the underlying HTTP request:

| Decorator | Equivalent Object |
| :--- | :--- |
| `@Req()`, `@Request()` | `req` |
| `@Res()`, `@Response()` | `res` |
| `@Next()` | `next` |
| `@Session()` | `req.session` |
| `@Param(key?: string)` | `req.params` or `req.params[key]` |
| `@Body(key?: string)` | `req.body` or `req.body[key]` |
| `@Query(key?: string)` | `req.query` or `req.query[key]` |
| `@Headers(name?: string)`| `req.headers` or `req.headers[name]` |
| `@Ip()` | `req.ip` |
| `@HostParam()` | `req.hosts` |

---

## 2. Creating Custom Parameter Decorators

In real-world applications, properties such as authenticated user context, tenant IDs, or API tokens are attached to the `request` object by authentication middleware or guards.

Instead of writing repetitive extraction logic:
```typescript
// ❌ Repetitive & Imperative
@Get('me')
getProfile(@Req() req: Request) {
  const user = req.user;
  return user;
}
```

You can define a reusable, strongly-typed `@CurrentUser()` decorator using `createParamDecorator`:

```typescript
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    // If a specific property key was passed (e.g. @CurrentUser('email'))
    return data ? user?.[data] : user;
  },
);
```

### Usage in Route Handlers
```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator.js';
import { AuthGuard } from './auth.guard.js';

@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  // Extracts entire user object
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // Extracts specific field
  @Get('email')
  getEmail(@CurrentUser('email') email: string) {
    return { email };
  }
}
```

---

## 3. Validating Custom Decorators with Pipes

Nest treats custom parameter decorators the same as built-in ones (`@Body()`, `@Query()`). You can apply validation pipes directly to custom parameter decorators:

```typescript
import { ValidationPipe } from '@nestjs/common';

@Get('profile')
getProfile(
  @CurrentUser(new ValidationPipe({ validateCustomDecorators: true }))
  user: AuthenticatedUser,
) {
  return user;
}
```

> **Note**: To enable validation on custom decorators, the `validateCustomDecorators` option must be set to `true`.

---

## 4. Decorator Composition with `applyDecorators`

When endpoints require multiple decorators (e.g., authentication guards, role guards, OpenAPI swagger metadata, and response types), declaring them repeatedly introduces clutter:

```typescript
// ❌ Cluttered repetitive decorators
@Get('admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles(['admin'])
@ApiBearerAuth()
@ApiResponse({ status: 200, description: 'Success' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
findAll() {}
```

Nest provides the `applyDecorators()` utility function to compose multiple decorators into a single, clean composite decorator:

```typescript
// auth.decorator.ts
import { applyDecorators, UseGuards, SetMetadata } from '@nestjs/common';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { Roles, type Role } from './roles.decorator.js';

export function RequireAuth(...roles: Role[]) {
  return applyDecorators(
    Roles(roles),
    UseGuards(AuthGuard, RolesGuard),
  );
}
```

### Clean Consumption in Controllers
```typescript
import { Controller, Get } from '@nestjs/common';
import { RequireAuth } from './common/decorators/auth.decorator.js';

@Controller('admin')
export class AdminController {
  @Get('dashboard')
  @RequireAuth('admin')
  getDashboard() {
    return { status: 'operational' };
  }
}
```
All guards and metadata are applied cleanly in a single declaration.

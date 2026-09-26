# 08 - Guards

> **Source Reference**: [NestJS Official Documentation - Guards](https://docs.nestjs.com/guards)

A guard is an `@Injectable()` class implementing the `CanActivate` interface. Guards have a **single responsibility**: they determine whether an incoming request will be permitted to reach the route handler, based on runtime conditions such as authentication tokens, roles, permissions, or access control lists (ACL).

---

## 1. Execution Order & Timing

> **PIPELINE GUARANTEE**: Guards are executed **after** all middleware, but **before** any interceptor or pipe.

```text
Incoming Request ──► Middleware ──► [GUARDS] ──► Interceptors (Pre) ──► Pipes ──► Handler
                                       │
                                 Return false?
                                       │
                                       ▼
                             403 ForbiddenException
```

Because guards run *after* middleware, they have access to the fully populated request object (e.g. headers, sessions). Unlike middleware, guards are aware of the **execution context**—they know exactly which controller class and route method is about to be executed.

---

## 2. The `CanActivate` Contract & `ExecutionContext`

Every guard must implement the `canActivate()` method:

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Observable } from 'rxjs';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['authorization'];

    // If false is returned, Nest automatically throws a 403 ForbiddenException
    return Boolean(token && token.startsWith('Bearer '));
  }
}
```

### Return Values & Denial Behavior
* **`true`**: The request is authorized and allowed to proceed down the pipeline.
* **`false`**: Nest denies the request, immediately throwing a `403 ForbiddenException` (`{ "statusCode": 403, "message": "Forbidden resource" }`).
* **Explicit Exceptions**: To return a specific error (e.g. `401 Unauthorized`), throw it directly inside `canActivate`:
  ```typescript
  if (!token) {
    throw new UnauthorizedException('Missing bearer authentication token');
  }
  ```

---

## 3. The `ExecutionContext` Object

`ExecutionContext` extends `ArgumentsHost` and provides access to the invocation context:

```typescript
// Inspect the target controller class
const controllerClass = context.getClass(); // e.g. UsersController

// Inspect the target route handler method
const handlerMethod = context.getHandler(); // e.g. createUser()

// Switch to HTTP context to access platform objects
const httpCtx = context.switchToHttp();
const req = httpCtx.getRequest();
const res = httpCtx.getResponse();
```

---

## 4. Role-Based Access Control (RBAC) with `Reflector`

To implement fine-grained permissions, combine guards with **custom metadata reflection**.

### Step 1: Define a Type-Safe Decorator
Use Nest's `Reflector.createDecorator()` to define a strongly-typed decorator:

```typescript
// roles.decorator.ts
import { Reflector } from '@nestjs/core';

export type Role = 'admin' | 'user' | 'editor';

export const Roles = Reflector.createDecorator<Role[]>();
```

### Step 2: Annotate Controller Routes
```typescript
// users.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  @Post('admin-action')
  @Roles(['admin'])
  performAdminTask(@Body() data: unknown) {
    return { success: true };
  }
}
```

### Step 3: Implement the RolesGuard
The guard uses `Reflector` to retrieve the allowed roles attached to the handler (or controller class) and checks them against the authenticated user:

```typescript
// roles.guard.ts
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles, type Role } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Retrieve metadata defined on the route handler or fall back to the class
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are specified, the route is public
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: string; roles: Role[] } | undefined;

    if (!user || !user.roles) {
      return false; // Will trigger 403 Forbidden
    }

    return requiredRoles.some((role) => user.roles.includes(role));
  }
}
```

---

## 5. Binding Guards

### 1. Method-Scoped
```typescript
@Get('metrics')
@UseGuards(AdminGuard)
getMetrics() {}
```

### 2. Controller-Scoped
```typescript
@Controller('billing')
@UseGuards(AuthGuard, BillingGuard)
export class BillingController {}
```

### 3. Global Guard with Dependency Injection (`APP_GUARD`)
Registering guards in `AppModule` using `APP_GUARD` ensures they run globally across every route while supporting full dependency injection:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard.js';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
```
Multiple global guards run in the exact order they are registered in the `providers` array.

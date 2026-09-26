# 08 - Execution Context

> **Source Reference**: [NestJS Official Documentation - Execution Context](https://docs.nestjs.com/fundamentals/execution-context)

Nest is designed to work across multiple application protocols: HTTP REST APIs, WebSockets, gRPC microservices, and GraphQL. To enable guards, interceptors, and exception filters to operate universally across all these protocols, Nest provides two foundational abstraction classes:
1. **`ArgumentsHost`**
2. **`ExecutionContext`**

---

## 1. The `ArgumentsHost` Class

`ArgumentsHost` encapsulates the arguments passed to an execution handler. It provides methods to inspect the current execution type and extract protocol-specific objects safely:

```typescript
import { ArgumentsHost, ExceptionFilter, Catch } from '@nestjs/common';

@Catch()
export class UniversalFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 1. Determine execution protocol
    const type = host.getType(); // 'http' | 'rpc' | 'ws' | 'graphql'

    if (type === 'http') {
      const ctx = host.switchToHttp();
      const request = ctx.getRequest();
      const response = ctx.getResponse();
      // Handle HTTP error
    } else if (type === 'rpc') {
      const ctx = host.switchToRpc();
      const data = ctx.getData();
      // Handle Microservice error
    } else if (type === 'ws') {
      const ctx = host.switchToWs();
      const client = ctx.getClient();
      // Handle WebSocket error
    }
  }
}
```

---

## 2. The `ExecutionContext` Class

`ExecutionContext` extends `ArgumentsHost`, adding methods to inspect the **class** and **method** that are about to be invoked in the pipeline:

```typescript
export interface ExecutionContext extends ArgumentsHost {
  /**
   * Returns the constructor Type of the target controller class.
   */
  getClass<T>(): Type<T>;

  /**
   * Returns a reference to the target route handler method.
   */
  getHandler(): Function;
}
```

### Practical Usage in Guards and Interceptors
```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

@Injectable()
export class LoggingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const controllerName = context.getClass().name; // e.g. "ProductsController"
    const handlerName = context.getHandler().name;   // e.g. "createProduct"

    console.log(`Routing request to: ${controllerName}#${handlerName}`);
    return true;
  }
}
```

---

## 3. Reflection & Custom Metadata

Guards and interceptors frequently make decisions based on metadata attached to route handlers (e.g. required roles, rate limits, feature flags).

### Step 1: Create a Strongly-Typed Decorator (`Reflector.createDecorator`)
```typescript
// roles.decorator.ts
import { Reflector } from '@nestjs/core';

export type Role = 'admin' | 'moderator' | 'user';

export const Roles = Reflector.createDecorator<Role[]>();
```

### Step 2: Annotate Routes or Controllers
```typescript
// products.controller.ts
@Controller('products')
@Roles(['user']) // Controller-level fallback metadata
export class ProductsController {
  @Post()
  @Roles(['admin']) // Method-level override metadata
  create() {}
}
```

### Step 3: Extract & Combine Metadata with `Reflector`
The `Reflector` service provides three primary methods for reading metadata:

```typescript
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles, type Role } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Strategy 1: Read only from the handler method
    const methodRoles = this.reflector.get(Roles, context.getHandler());

    // Strategy 2: Get first defined value, prioritizing Method over Controller (Override)
    const activeRoles = this.reflector.getAllAndOverride<Role[]>(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Strategy 3: Concatenate and merge metadata from both levels (Merge)
    const combinedRoles = this.reflector.getAllAndMerge<Role[]>(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    return true;
  }
}
```

---

## 4. Low-Level Metadata: `@SetMetadata()`

Before `Reflector.createDecorator()`, custom metadata was defined using the low-level `@SetMetadata()` decorator:

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

To read it with `Reflector`:
```typescript
const roles = this.reflector.get<string[]>(ROLES_KEY, context.getHandler());
```

> **Best Practice**: Prefer `Reflector.createDecorator<T>()` over `@SetMetadata()`. It provides compile-time type safety for both the decorator arguments and the return value of `reflector.get()`.

# 05 - Circular Dependencies

> **Source Reference**: [NestJS Official Documentation - Circular Dependency](https://docs.nestjs.com/fundamentals/circular-dependency)

A circular dependency occurs when two classes depend on each other (e.g. `Class A` injects `Class B`, and `Class B` injects `Class A`). In NestJS, circular dependencies can manifest between **providers** or between **modules**.

While circular dependencies should be avoided through clean domain refactoring, NestJS provides mechanisms to resolve them safely when necessary.

---

## 1. Provider Circular Dependencies & `forwardRef()`

When two services depend on each other, TypeScript cannot resolve the circular reference at runtime because one of the classes is referenced before it has been defined.

Nest solves this with the `forwardRef()` utility function, which defers reference resolution until both classes are loaded:

```typescript
// users.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}
}
```

```typescript
// orders.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}
}
```

> **Warning on Instantiation Order**: With `forwardRef()`, the order of instantiation is indeterminate. Never write code that assumes one constructor executes before the other.

---

## 2. Resolving via `ModuleRef` (Alternative to `forwardRef`)

An alternative to `forwardRef()` that keeps constructor signatures clean is retrieving the dependency dynamically via `ModuleRef` during lifecycle initialization:

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OrdersService } from '../orders/orders.service.js';

@Injectable()
export class UsersService implements OnModuleInit {
  private ordersService!: OrdersService;

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    this.ordersService = this.moduleRef.get(OrdersService, { strict: false });
  }
}
```

---

## 3. Module Circular Dependencies

When two modules import each other, use `forwardRef()` in the `imports` arrays of **both** modules:

```typescript
// users.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [forwardRef(() => OrdersModule)],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

```typescript
// orders.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

---

## 4. The Barrel File (`index.ts`) Hazard

> **CRITICAL WARNING**: A frequent source of false circular dependencies in TypeScript is the misuse of barrel files (`index.ts`).

### The Anti-Pattern
```text
users/
├── index.ts               # Re-exports * from users.service and users.controller
├── users.controller.ts    # Imports { UsersService } from './index.js' ❌
└── users.service.ts       # Imports { UsersRepository } from './users.repository.js'
```

If a file inside a directory imports another file in the same directory through the local `index.ts` barrel, Node.js and TypeScript often encounter an uninitialized export, resulting in `TypeError: Cannot read properties of undefined` or `Nest can't resolve dependencies`.

### Best Practice
* **Never use barrel files for sibling imports within the same module directory.**
* Always import directly from the concrete file: `import { UsersService } from './users.service.js';`.
* Reserve `index.ts` exclusively for the public API of shared packages (e.g. `packages/contracts/src/index.ts`).

---

## 5. Architectural Refactoring: Extracting Mediators

Circular dependencies often signal that two services share overlapping responsibilities. Rather than masking the issue with `forwardRef()`, the best architectural solution is to extract the shared logic into a third **mediator service**:

```text
BEFORE (Circular):
[UsersService] ◄────────────► [OrdersService]

AFTER (Clean Architecture):
[UsersService] ◄──┐        ┌──► [OrdersService]
                  │        │
           [UserOrderCoordinator]
```

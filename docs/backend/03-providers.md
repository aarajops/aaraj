# 03 - Providers

> **Source Reference**: [NestJS Official Documentation - Providers](https://docs.nestjs.com/providers)

Providers are the fundamental building blocks of a Nest application. Services, repositories, factories, helpers, and data mappers can all be treated as providers. The core concept behind a provider is that it can be **injected as a dependency**, allowing the Nest Inversion of Control (IoC) runtime container to wire objects together automatically.

---

## 1. Services as Providers

Application business logic, persistence operations, and external system integrations should be encapsulated in services annotated with `@Injectable()`:

```typescript
import { Injectable } from '@nestjs/common';

export interface User {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UsersService {
  private readonly users: User[] = [];

  create(user: User): User {
    this.users.push(user);
    return user;
  }

  findAll(): User[] {
    return this.users;
  }

  findById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }
}
```

The `@Injectable()` decorator attaches metadata to the class, signaling that the class can be managed by the Nest IoC container.

---

## 2. Dependency Injection Mechanism

Nest is built around the **Dependency Injection (DI)** design pattern. When a controller or another provider requires a service, it declares the dependency in its `constructor`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { UsersService, type User } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): User | undefined {
    return this.usersService.findById(id);
  }
}
```

### How Nest Resolves Dependencies
1. **Parameter Property**: The `private readonly` modifier automatically creates and assigns the `usersService` class member without requiring manual boilerplate (`this.usersService = usersService`).
2. **Metadata Emission**: TypeScript emits the parameter's design type (`UsersService`) into compiled JavaScript metadata when `emitDecoratorMetadata` is enabled.
3. **Container Lookup**: The Nest IoC container inspects the metadata, finds the registered `UsersService` singleton, and injects it into the constructor.

---

## 3. Critical Rule: Concrete Classes vs. Erased Interfaces

> **WARNING**: In TypeScript, **interfaces** and **type aliases** are completely erased during compilation to JavaScript.

If you attempt to inject an interface:
```typescript
// ❌ FAILS AT RUNTIME: "Nest can't resolve dependencies of UsersController (?)"
constructor(private readonly repo: IUserRepository) {}
```
Because `IUserRepository` does not exist in the JavaScript output, TypeScript emits `Object` as the metadata token, leaving Nest unable to determine what provider to supply.

### The Solution: Explicit Injection Tokens
When programming against interfaces or abstract contracts, you must use an explicit token (a `string`, `Symbol`, or `abstract class`) paired with `@Inject()`:

```typescript
// Define token
export const USER_REPOSITORY_TOKEN = Symbol('USER_REPOSITORY');

// Inject with token
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepo: IUserRepository,
  ) {}
}
```

---

## 4. Provider Scopes & Scope Bubbling

By default, providers in NestJS are **Singletons** (`Scope.DEFAULT`). Nest creates a single instance during application bootstrap and shares that instance across all consumers.

| Scope | Enum Value | Lifetime & Behavior |
| :--- | :--- | :--- |
| **Default (Singleton)** | `Scope.DEFAULT` | A single instance is cached and shared across the entire application. Created once at startup. Highly performant. |
| **Request** | `Scope.REQUEST` | A new instance is created for **every incoming HTTP request** and garbage-collected when the request completes. |
| **Transient** | `Scope.TRANSIENT` | A distinct instance is dedicated to each provider or controller that injects it. |

```typescript
import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class RequestContextService {
  public requestId?: string;
}
```

### ⚠️ Scope Bubbling Hazard
**Request scoping bubbles up the dependency tree.**
* If `ServiceA` is request-scoped, and `ControllerB` injects `ServiceA`, then `ControllerB` automatically becomes request-scoped.
* If a singleton service injects a request-scoped service, the singleton is forced into request scope for that path.
* **Best Practice**: Keep all providers at `Scope.DEFAULT` whenever possible. Avoid `Scope.REQUEST` unless strictly necessary (e.g. multi-tenant database connection switching). Never use request scope just to pass user identity—pass user identity through method parameters.

---

## 5. Custom Providers

The standard `@Injectable()` class is the most common provider, but Nest's IoC container supports full custom provider strategies:

### 1. Value Providers (`useValue`)
Useful for constants, configuration objects, or mocking dependencies in unit tests:
```typescript
const mockUsersService = {
  findAll: () => [{ id: '1', name: 'Mock User' }],
};

@Module({
  providers: [
    {
      provide: UsersService,
      useValue: mockUsersService,
    },
  ],
})
export class UsersModule {}
```

### 2. Class Providers (`useClass`)
Allows dynamically resolving a token to different class implementations (e.g. development mock vs. production service):
```typescript
@Module({
  providers: [
    {
      provide: ConfigService,
      useClass: process.env.NODE_ENV === 'production' 
        ? ProductionConfigService 
        : LocalConfigService,
    },
  ],
})
export class AppModule {}
```

### 3. Factory Providers (`useFactory`)
Creates providers dynamically, supporting both synchronous and asynchronous factories with injected dependencies:
```typescript
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: async (config: ConfigService) => {
        const client = new DatabaseClient(config.getDbUri());
        await client.connect();
        return client;
      },
      inject: [ConfigService], // Injected dependencies passed as factory arguments
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
```

### 4. Aliased Providers (`useExisting`)
Creates an alias for an existing registered provider token:
```typescript
@Module({
  providers: [
    LoggerService,
    {
      provide: 'AppLogger',
      useExisting: LoggerService,
    },
  ],
})
export class LoggingModule {}
```

---

## 6. Optional Providers (`@Optional()`)

When a dependency is non-essential and your class can operate with sensible defaults if the dependency is absent, use `@Optional()`:

```typescript
import { Injectable, Optional, Inject } from '@nestjs/common';

export interface CacheOptions {
  ttlMs: number;
}

@Injectable()
export class CacheService {
  private readonly ttl: number;

  constructor(
    @Optional()
    @Inject('CACHE_OPTIONS')
    options?: CacheOptions,
  ) {
    this.ttl = options?.ttlMs ?? 60_000; // Fallback to 60s
  }
}
```

---

## 7. Property-Based Injection

When subclasses inherit from a base class with multiple dependencies, passing all dependencies through `super()` constructor calls becomes difficult to maintain. Property injection allows injecting directly into fields:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { LoggerService } from './logger.service.js';

@Injectable()
export class BaseEntityService {
  @Inject()
  protected readonly logger!: LoggerService;
}
```

> **Warning**: Use constructor injection by default. Only use property injection when resolving deep inheritance hierarchies.

---

## 8. Provider Registration & Module Boundaries

Providers must be declared in the `providers` array of a `@Module()` to be available within that module:

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Must export to share with importing modules
})
export class UsersModule {}
```

---

## 9. Manual Instantiation (`ModuleRef`)

To dynamically retrieve providers outside of constructor injection or within dynamic plugins, use `ModuleRef`:

```typescript
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PaymentStrategy } from './payment.strategy.js';

@Injectable()
export class PaymentRouterService {
  constructor(private readonly moduleRef: ModuleRef) {}

  getStrategy(strategyClass: typeof PaymentStrategy): PaymentStrategy {
    return this.moduleRef.get(strategyClass, { strict: false });
  }
}
```

# 04 - Modules

> **Source Reference**: [NestJS Official Documentation - Modules](https://docs.nestjs.com/modules)

A module is a class annotated with a `@Module()` decorator. The `@Module()` decorator provides metadata that Nest uses to organize the application structure, establish dependency injection boundaries, and construct the application graph.

---

## 1. Module Architecture & Metadata

Every NestJS application has at least one module: the **Root Module** (typically `AppModule`). The root module is the starting point Nest uses to build the application graph—the internal data structure Nest uses to resolve module and provider relationships.

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [],       // List of imported modules that export the providers required by this module
  controllers: [UsersController], // Controllers defined in this module which have to be instantiated
  providers: [UsersService],     // Providers that will be instantiated by the Nest injector and may be shared at least across this module
  exports: [UsersService],       // The subset of providers that are provided by this module and should be available in other modules which import this module
})
export class UsersModule {}
```

### Module Metadata Properties

| Property | Purpose |
| :--- | :--- |
| `providers` | Array of providers that will be instantiated by the Nest injector and scoped to this module. |
| `controllers` | Array of HTTP controllers defined in this module that should be instantiated and mapped to routes. |
| `imports` | Array of modules whose exported providers are needed by the providers in this module. |
| `exports` | Array of providers defined in this module that should be made available to any module that imports this module. |

---

## 2. Encapsulation & Provider Visibility

In Nest, modules **strongly encapsulate** providers by default:
* A provider registered in `providers` is **private** to that module.
* Other modules cannot inject that provider unless it is explicitly added to the module's `exports` array.
* When `OrdersModule` imports `UsersModule`, it gains access **only** to the providers explicitly listed in `UsersModule`'s `exports`.

```text
┌───────────────────────────┐         ┌───────────────────────────┐
│        UsersModule        │         │       OrdersModule        │
│                           │         │                           │
│  Private: UsersRepository │         │  Imports: [UsersModule]   │
│                           │         │                           │
│  Exports: [UsersService] ─┼────────►│  Can Inject: UsersService │
└───────────────────────────┘         └───────────────────────────┘
```

---

## 3. Shared Modules & Singleton Reusability

In Nest, modules are **singletons by default**. Once an instance of a provider is created in a module, that identical instance can be shared across any number of modules that import it:

```typescript
import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
```

Any module that imports `DatabaseModule` will receive the same singleton `DatabaseService` instance.

---

## 4. Module Re-Exporting

A module can re-export modules that it imports, effectively chaining exports for consumer convenience:

```typescript
@Module({
  imports: [CommonModule],
  exports: [CommonModule],
})
export class CoreModule {}
```

Any module importing `CoreModule` immediately gets access to all exported providers of `CommonModule`.

---

## 5. Global Modules (`@Global()`)

If a module must be available everywhere (such as database connections, logging, or environment configuration), re-importing it into every single feature module creates unnecessary boilerplate. You can mark a module as global using `@Global()`:

```typescript
import { Module, Global } from '@nestjs/common';
import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
```

Once `ConfigModule` is imported into the root `AppModule`, `ConfigService` can be injected across all application modules without re-importing `ConfigModule`.

> **Best Practice**: Use `@Global()` sparingly. Making everything global undermines architectural modularity and makes unit testing and refactoring harder to reason about. Reserve `@Global()` strictly for infrastructure primitives.

---

## 6. Dynamic Modules

Dynamic modules allow modules to be configured dynamically with custom options before being registered in the application graph.

### Convention: `register`, `forRoot`, `forFeature`

* `register`: Used when configuring a dynamic module with specific options for a single use case.
* `forRoot`: Used when configuring a module once at the application root (e.g., database connection, telemetry).
* `forFeature`: Used when configuring a child feature or entity within a module that has already been initialized via `forRoot`.

### Implementing a Dynamic Module

```typescript
import { Module, type DynamicModule } from '@nestjs/common';
import { JwtService } from './jwt.service.js';

export interface JwtModuleOptions {
  secret: string;
  expiresInSeconds: number;
}

export const JWT_OPTIONS_TOKEN = Symbol('JWT_OPTIONS');

@Module({})
export class JwtModule {
  static register(options: JwtModuleOptions): DynamicModule {
    return {
      module: JwtModule,
      providers: [
        {
          provide: JWT_OPTIONS_TOKEN,
          useValue: options,
        },
        JwtService,
      ],
      exports: [JwtService],
    };
  }
}
```

### Consumption
```typescript
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'fallback-secret',
      expiresInSeconds: 3600,
    }),
  ],
})
export class AuthModule {}
```

### Asynchronous Dynamic Modules (`forRootAsync`)
For configurations that require asynchronous setup (such as fetching database credentials from a secret manager or reading async configuration files):

```typescript
@Module({})
export class DatabaseModule {
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<DbConfig> | DbConfig;
    inject?: any[];
  }): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: 'DB_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }
}
```

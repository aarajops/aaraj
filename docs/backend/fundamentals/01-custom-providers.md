# 01 - Custom Providers

> **Source Reference**: [NestJS Official Documentation - Custom Providers](https://docs.nestjs.com/fundamentals/custom-providers)

Dependency Injection (DI) is an **Inversion of Control (IoC)** design pattern where the instantiation of dependencies is delegated to the NestJS runtime IoC container rather than imperatively constructed in business logic.

---

## 1. Standard Providers vs. Explicit Registration

In standard usage, listing a class in a module's `providers` array:

```typescript
@Module({
  controllers: [CatsController],
  providers: [CatsService],
})
export class AppModule {}
```

Is actually shorthand for the explicit custom provider definition:

```typescript
providers: [
  {
    provide: CatsService, // The Injection Token
    useClass: CatsService, // The Class to instantiate
  },
]
```

This syntax connects an **Injection Token** (`CatsService`) with a recipe for creating the instance (`useClass: CatsService`).

---

## 2. When to Use Custom Providers

Custom providers are required when:
1. You want to inject a **concrete value or pre-existing instance** (e.g. third-party SDK client, configuration object) rather than allowing Nest to call `new`.
2. You want to **swap implementations dynamically** based on environment variables (e.g. `DevelopmentConfigService` vs. `ProductionConfigService`).
3. You want to **replace real services with mock implementations** during unit or E2E testing.
4. You want to inject dependencies using **non-class tokens** (`Symbol` or `string`) to decouple interfaces from concrete implementations.

---

## 3. Value Providers (`useValue`)

The `useValue` syntax binds a token directly to a static value, external library instance, or mock object:

```typescript
import { Module } from '@nestjs/common';
import { CatsService } from './cats.service.js';

const mockCatsService = {
  findAll: () => [{ id: '1', name: 'Mock Cat' }],
};

@Module({
  providers: [
    {
      provide: CatsService,
      useValue: mockCatsService,
    },
  ],
})
export class AppModule {}
```

Because TypeScript uses **structural typing**, `mockCatsService` satisfies the contract as long as its public shape matches `CatsService`.

---

## 4. Non-Class Tokens: Strings & Symbols

Standard constructor injection uses TypeScript class names as tokens. However, tokens can also be **Strings** or **JavaScript Symbols**:

```typescript
// Define tokens in a dedicated tokens.ts file
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');
export const APP_CONFIG = 'APP_CONFIG';
```

### Registration in Module
```typescript
import { Module } from '@nestjs/common';
import { DATABASE_CONNECTION } from './tokens.js';
import { externalDbConnection } from './connection.js';

@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useValue: externalDbConnection,
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
```

### Injection via `@Inject()`
When injecting a non-class token, the constructor parameter **must** use the `@Inject()` decorator:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from './tokens.js';
import type { DbConnection } from './connection.interface.js';

@Injectable()
export class CatsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: DbConnection,
  ) {}
}
```

> **Best Practice**: Use `Symbol()` instead of raw strings. Symbols have unique runtime identities, preventing accidental token collisions between unrelated modules.

---

## 5. Architectural Rule: Interfaces vs. Abstract Classes

> **CRITICAL RULE**: In TypeScript, **interfaces** are completely erased during compilation to JavaScript. They do not exist at runtime!

### ❌ The Interface Anti-Pattern
```typescript
// Fails at startup: "Nest can't resolve dependencies of CatsService (?)"
constructor(private readonly logger: ILogger) {}
```
Because `ILogger` disappears after compilation, TypeScript emits `Object` as the metadata token, leaving Nest unable to determine what provider to inject.

### Solution A: Symbol Token + Interface (Decoupled)
```typescript
export interface ILogger {
  log(msg: string): void;
}
export const LOGGER_TOKEN = Symbol('LOGGER_TOKEN');

@Injectable()
export class CatsService {
  constructor(
    @Inject(LOGGER_TOKEN)
    private readonly logger: ILogger,
  ) {}
}
```

### Solution B: Abstract Class Token (Concise)
Abstract classes **do** exist at runtime in JavaScript. An abstract class serves as both the compile-time contract and the runtime injection token:

```typescript
// logger.abstract.ts
export abstract class AbstractLogger {
  abstract log(msg: string): void;
}

// In Module
@Module({
  providers: [
    {
      provide: AbstractLogger,
      useClass: WinstonLoggerService,
    },
  ],
})
export class LoggingModule {}

// In Consumer (No @Inject needed!)
@Injectable()
export class CatsService {
  constructor(private readonly logger: AbstractLogger) {}
}
```

---

## 6. Class Providers (`useClass`)

Allows dynamically selecting which class to instantiate for a given token:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from './config.service.js';
import { DevConfigService } from './dev-config.service.js';
import { ProdConfigService } from './prod-config.service.js';

@Module({
  providers: [
    {
      provide: ConfigService,
      useClass: process.env.NODE_ENV === 'production' 
        ? ProdConfigService 
        : DevConfigService,
    },
  ],
})
export class AppModule {}
```

---

## 7. Factory Providers (`useFactory`)

Creates providers dynamically via a factory function. The factory can accept dependencies injected via the `inject` array:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from './config.service.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService, optionalLogger?: LoggerService) => {
        const client = new RedisClient({ host: config.redisHost });
        if (optionalLogger) {
          client.on('error', (err) => optionalLogger.error(err));
        }
        return client;
      },
      // Dependencies passed to the factory in matching order
      inject: [
        ConfigService, 
        { token: LoggerService, optional: true },
      ],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

---

## 8. Alias Providers (`useExisting`)

Creates an alias for an existing registered provider, allowing two different tokens to resolve to the same underlying singleton instance:

```typescript
@Injectable()
export class ConsoleLoggerService {}

@Module({
  providers: [
    ConsoleLoggerService,
    {
      provide: 'AppLogger',
      useExisting: ConsoleLoggerService,
    },
  ],
})
export class LoggingModule {}
```

---

## 9. Exporting Custom Providers

To make a custom provider visible to other modules, export it either by its **token** or as the **full provider definition**:

```typescript
@Module({
  providers: [connectionFactory],
  // Export by token:
  exports: [DATABASE_CONNECTION],
  // Or export full definition:
  // exports: [connectionFactory],
})
export class DatabaseModule {}
```

---

## 10. Debugging Dependency Resolution

If Nest fails to resolve dependencies during startup, enable deep resolution logging:
```bash
NEST_DEBUG=true pnpm --filter @aaraj/api start:dev
```
This logs every step of the dependency graph analysis, pinpointing missing imports or circular dependencies.

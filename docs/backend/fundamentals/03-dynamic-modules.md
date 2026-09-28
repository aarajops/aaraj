# 03 - Dynamic Modules

> **Source Reference**: [NestJS Official Documentation - Dynamic Modules](https://docs.nestjs.com/fundamentals/dynamic-modules)

Most modules in NestJS are **static**: their providers, controllers, and dependencies are statically declared in the `@Module()` decorator. Static binding works well when all consuming modules require the exact same configuration.

However, general-purpose modules (such as configuration managers, database drivers, JWT authenticators, or notification clients) must often be **customized dynamically** by the consuming module. **Dynamic modules** provide an API to configure and instantiate modules programmatically at runtime.

---

## 1. Manual Dynamic Module Implementation

A dynamic module is a standard class that defines a **static method** (conventionally named `register`, `forRoot`, or `forFeature`) returning an object that implements the `DynamicModule` interface:

### Step 1: Define the Options & Injection Token
```typescript
// id-generator.interfaces.ts
export interface IdGeneratorOptions {
  prefix: string;
}

export const ID_GENERATOR_OPTIONS = Symbol('ID_GENERATOR_OPTIONS');
```

### Step 2: Implement the Injectable Service
```typescript
// id-generator.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ID_GENERATOR_OPTIONS, type IdGeneratorOptions } from './id-generator.interfaces.js';

@Injectable()
export class IdGeneratorService {
  constructor(
    @Inject(ID_GENERATOR_OPTIONS)
    private readonly options: IdGeneratorOptions,
  ) {}

  generate(): string {
    return `${this.options.prefix}_${randomUUID()}`;
  }
}
```

### Step 3: Implement the Dynamic Module Class
```typescript
// id-generator.module.ts
import { Module, type DynamicModule } from '@nestjs/common';
import { IdGeneratorService } from './id-generator.service.js';
import {
  ID_GENERATOR_OPTIONS,
  type IdGeneratorOptions,
} from './id-generator.interfaces.js';

@Module({})
export class IdGeneratorModule {
  static register(options: IdGeneratorOptions): DynamicModule {
    return {
      module: IdGeneratorModule, // Mandatory reference to the host class
      providers: [
        {
          provide: ID_GENERATOR_OPTIONS,
          useValue: options,
        },
        IdGeneratorService,
      ],
      exports: [IdGeneratorService],
    };
  }
}
```

### Step 4: Import with Custom Configuration
```typescript
@Module({
  imports: [IdGeneratorModule.register({ prefix: 'usr' })],
  providers: [UsersService],
})
export class UsersModule {}

@Module({
  imports: [IdGeneratorModule.register({ prefix: 'ord' })],
  providers: [OrdersService],
})
export class OrdersModule {}
```
Each consuming module receives its own isolated `IdGeneratorService`, generating `usr_...` and `ord_...` identifiers respectively.

---

## 2. Community Naming Conventions

The Nest ecosystem follows strict conventions for dynamic module methods:

| Method | Typical Use Case | Example |
| :--- | :--- | :--- |
| `register()` | Configures a dynamic module for use **only by the specific calling module**. | `JwtModule.register({ secret: '...' })` |
| `forRoot()` | Configures a dynamic module **once at the application root** to be reused across the application. | `TypeOrmModule.forRoot({ ... })` |
| `forFeature()` | Uses the root configuration established by `forRoot()`, but modifies a subset for the calling module (e.g. entities or repositories). | `TypeOrmModule.forFeature([UserEntity])` |
| `*Async()` | The asynchronous counterpart of any of the above, resolving configuration dynamically through dependency injection. | `JwtModule.registerAsync({ ... })` |

---

## 3. Modern Pattern: `ConfigurableModuleBuilder`

Manually building dynamic modules that support both synchronous (`register`) and asynchronous (`registerAsync` via `useFactory`, `useClass`, `useExisting`) methods introduces substantial boilerplate. 

NestJS provides the `ConfigurableModuleBuilder` class to generate full dynamic module definitions automatically:

### Step 1: Create the Module Definition (`module-definition.ts`)
```typescript
// mailer.module-definition.ts
import { ConfigurableModuleBuilder } from '@nestjs/common';

export interface MailerModuleOptions {
  apiKey: string;
  defaultSender: string;
}

export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<MailerModuleOptions>()
  .setClassMethodName('forRoot') // Generates forRoot() and forRootAsync()
  .build();
```

### Step 2: Extend the Generated Class in the Module
```typescript
// mailer.module.ts
import { Module } from '@nestjs/common';
import { ConfigurableModuleClass } from './mailer.module-definition.js';
import { MailerService } from './mailer.service.js';

@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule extends ConfigurableModuleClass {}
```

### Step 3: Inject Options via `MODULE_OPTIONS_TOKEN`
```typescript
// mailer.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { MODULE_OPTIONS_TOKEN, type MailerModuleOptions } from './mailer.module-definition.js';

@Injectable()
export class MailerService {
  constructor(
    @Inject(MODULE_OPTIONS_TOKEN)
    private readonly options: MailerModuleOptions,
  ) {}
}
```

### Step 4: Asynchronous Consumption
Consuming modules can now configure the module asynchronously via factories or config services with zero manual boilerplate:

```typescript
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        apiKey: config.getOrThrow('SENDGRID_API_KEY'),
        defaultSender: 'no-reply@aaraj.com',
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

---

## 4. Extra Options (`setExtras`)

When a dynamic module requires metadata flags (such as `isGlobal: boolean`) that control how the module is registered rather than being passed into the service options, use `setExtras`:

```typescript
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<MailerModuleOptions>()
    .setClassMethodName('forRoot')
    .setExtras(
      { isGlobal: false },
      (definition, extras) => ({
        ...definition,
        global: extras.isGlobal,
      }),
    )
    .build();
```

Consumers can now pass `isGlobal: true` to make the module global without polluting the `MailerModuleOptions` injected into `MailerService`:

```typescript
@Module({
  imports: [
    MailerModule.forRoot({
      apiKey: 'secret_123',
      defaultSender: 'support@aaraj.com',
      isGlobal: true, // Configures module metadata, excluded from MODULE_OPTIONS_TOKEN
    }),
  ],
})
export class AppModule {}
```

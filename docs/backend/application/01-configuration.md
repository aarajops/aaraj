# 01 - Configuration

> **Source Reference**: [NestJS Official Documentation - Configuration](https://docs.nestjs.com/application/configuration)

Applications operate in multiple environments (local development, CI test runners, staging clusters, production Kubernetes pods). Following the [Twelve-Factor App methodology](https://12factor.net/config), configuration settings must be strictly segregated from application code and stored in the environment.

NestJS provides the `@nestjs/config` package to manage configuration loading, precedence resolution, strict schema validation, and dependency-injected access across the application graph.

---

## 1. Core Architecture & Installation

The `@nestjs/config` package sits on top of [dotenv](https://github.com/motdotla/dotenv) and [dotenv-expand](https://github.com/motdotla/dotenv-expand).

```bash
pnpm --filter @aaraj/api add @nestjs/config
```

### Basic Setup in `AppModule`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // ConfigService available globally without re-importing
      cache: true,    // Memoizes process.env lookup for performance
    }),
  ],
})
export class AppModule {}
```

### Precedence Resolution
When variables are resolved, `@nestjs/config` applies the following precedence:
1. **Host Environment Variables** (`process.env` set via OS, shell exports, Docker, Kubernetes ConfigMaps/Secrets).
2. **Local `.env` File** (parsed from the application working directory).

> **Precedence Inversion**: If you need local `.env` variables to override host environment variables, set `override: true` in `ConfigModule.forRoot()`.

---

## 2. Startup Schema Validation with Standard Schema & Zod

In enterprise backend applications, allowing the server to boot with missing or malformed configuration creates silent runtime failures. `@nestjs/config` supports the [Standard Schema](https://standardschema.dev/) specification, allowing libraries like **Zod** to validate and coerce environment variables before any provider or controller is instantiated.

### Installation

```bash
pnpm --filter @aaraj/api add zod
```

### Defining the Validation Schema

Environment variables are strings in `process.env`. Using `z.coerce` automatically casts numbers and booleans into their correct runtime types:

```typescript
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test', 'provision'])
    .default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  API_PREFIX: z.string().default('api'),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('*'),
});

export type EnvConfig = z.infer<typeof envSchema>;
```

### Applying Schema to `ConfigModule`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      cache: true,
    }),
  ],
})
export class AppModule {}
```

If `DATABASE_URL` is omitted or `JWT_SECRET` is less than 32 characters, bootstrapping fails immediately at startup with descriptive error messages:
```text
DATABASE_URL: Invalid url
JWT_SECRET: Too small: expected string to have >=32 characters
```

---

## 3. Custom Configuration Files & Namespaces

For complex domain applications, managing raw flat environment variables creates naming collisions and unorganized code. Custom configuration namespaces group related variables into domain-specific objects.

### Defining Namespaces with `registerAs`

Use `registerAs()` to create modular, typed configuration objects:

```typescript
// src/config/database.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? '',
  database: process.env.DATABASE_NAME ?? 'aaraj_db',
  maxConnections: parseInt(process.env.DATABASE_MAX_CONN ?? '20', 10),
}));
```

```typescript
// src/config/redis.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  keyPrefix: process.env.REDIS_PREFIX ?? 'aaraj:',
}));
```

### Registering Custom Namespaces

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config.js';
import redisConfig from './config/redis.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig],
    }),
  ],
})
export class AppModule {}
```

---

## 4. Injecting & Consuming Configuration

NestJS provides three ways to consume configuration settings:

### Approach A: Type-Safe Namespace Injection (`ConfigType`)

This is the recommended approach for domain modules. It delivers complete TypeScript autocompletion and eliminates magic string keys:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import databaseConfig from '../config/database.config.js';

@Injectable()
export class DatabaseService {
  constructor(
    @Inject(databaseConfig.KEY)
    private readonly dbConfig: ConfigType<typeof databaseConfig>,
  ) {}

  getConnectionString(): string {
    // dbConfig is fully typed: { host: string, port: number, username: string, ... }
    return `postgres://${this.dbConfig.username}:${this.dbConfig.password}@${this.dbConfig.host}:${this.dbConfig.port}/${this.dbConfig.database}`;
  }
}
```

### Approach B: Standard `ConfigService` with Key Inference

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../config/env.schema.js';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  getPort(): number {
    // With second generic `true`, return type excludes undefined:
    return this.configService.get('PORT', { infer: true });
  }

  getDbHost(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL');
  }
}
```

### Approach C: Zero-Boilerplate Async Module Integration (`asProvider()`)

When configuring third-party dynamic modules (e.g. TypeORM, Mongoose, BullMQ), namespaced configurations expose `.asProvider()` to supply their factory options directly:

```typescript
import { Module } from '@nestjs/common';
import databaseConfig from './config/database.config.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [
    DatabaseModule.forRootAsync(databaseConfig.asProvider()),
  ],
})
export class AppModule {}
```

This replaces the repetitive manual boilerplate:
```typescript
// What databaseConfig.asProvider() generates automatically:
{
  imports: [ConfigModule.forFeature(databaseConfig)],
  useFactory: (config: ConfigType<typeof databaseConfig>) => config,
  inject: [databaseConfig.KEY],
}
```

---

## 5. Advanced Configuration Capabilities

### Variable Expansion (`expandVariables`)
Enables nested referencing inside `.env` files using `${VARIABLE_NAME}` syntax:

```env
APP_DOMAIN=api.aaraj.io
AUTH_CALLBACK_URL=https://${APP_DOMAIN}/auth/callback
SUPPORT_EMAIL=support@${APP_DOMAIN}
```

Enable expansion in `forRoot`:
```typescript
ConfigModule.forRoot({
  expandVariables: true,
});
```

### CLI `--env-file` Flag vs. Nest Runtime
When variables are needed *before* the Node.js process evaluates module imports (e.g. dynamic imports or microservice port allocations passed to `NestFactory.createMicroservice`):

```bash
# Uses Node 20+ / 24+ native --env-file loader
nest start --env-file .env.production
```

### Dynamic Module Loading (`ConditionalModule`)
Conditionally load modules based on environment toggles without modifying module code:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConditionalModule } from '@nestjs/config';
import { MetricsModule } from './metrics/metrics.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(),
    // Only loads MetricsModule if ENABLE_METRICS !== 'false'
    ConditionalModule.registerWhen(MetricsModule, 'ENABLE_METRICS'),
    // Or with custom predicate:
    ConditionalModule.registerWhen(
      MetricsModule,
      (env: NodeJS.ProcessEnv) => env['NODE_ENV'] === 'production',
    ),
  ],
})
export class AppModule {}
```

---

## 6. Accessing Configuration in `main.ts`

Because `main.ts` is outside the module container, you access the singleton `ConfigService` through `app.get()` after `NestFactory.create()`:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT', 3000);
  const prefix = configService.get<string>('API_PREFIX', 'api');

  app.setGlobalPrefix(prefix);
  await app.listen(port);
}
bootstrap();
```

---

## 7. Production Best Practices Checklist

| Practice | Recommendation | Rationale |
| :--- | :--- | :--- |
| **Strict Schema Validation** | Always use `validationSchema` with Zod or Standard Schema | Prevents the app from starting up half-configured; fails early at deploy time. |
| **Use `cache: true`** | Set `cache: true` in `ConfigModule.forRoot()` | Prevents repeated, synchronous `process.env` lookups across requests. |
| **Type-Safe Injections** | Use `registerAs()` + `ConfigType<typeof config>` | Avoids fragile string keys like `'database.host'`; offers full compile-time refactoring safety. |
| **Never Check In `.env`** | Add `.env*` to `.gitignore` (except `.env.example`) | Prevents accidental leak of production credentials, API keys, and database passwords. |
| **Fail Fast with `getOrThrow`** | Use `configService.getOrThrow()` for mandatory settings | Guarantees non-null return types without runtime `undefined` bugs. |

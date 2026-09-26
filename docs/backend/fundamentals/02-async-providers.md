# 02 - Asynchronous Providers

> **Source Reference**: [NestJS Official Documentation - Asynchronous Providers](https://docs.nestjs.com/fundamentals/async-providers)

Sometimes, application startup must be delayed until one or more **asynchronous operations** complete successfully. For instance, an application should not begin accepting HTTP traffic until:
* Database connection pools are established and schema migrations have executed.
* Secrets and encryption keys are retrieved from a Cloud KMS or HashiCorp Vault.
* A distributed cache (e.g. Redis cluster) or message broker (e.g. Kafka, RabbitMQ) connection is active.

**Asynchronous providers** solve this cleanly by integrating promises directly into the NestJS Inversion of Control (IoC) dependency graph.

---

## 1. Syntax & Mechanics

An asynchronous provider is defined using `useFactory` with an `async` function (or a function returning a `Promise`):

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';

export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

export interface DatabaseConnection {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: async (config: ConfigService): Promise<DatabaseConnection> => {
        const connection = await createDbPool({
          host: config.get('DB_HOST'),
          port: config.get('DB_PORT'),
          user: config.get('DB_USER'),
          password: config.get('DB_PASSWORD'),
        });
        return connection;
      },
      inject: [ConfigService],
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
```

---

## 2. Bootstrapping Guarantees

When Nest encounters an asynchronous provider during application startup:
1. **Resolution Blocking**: Nest awaits the resolution of the `Promise` returned by the factory before instantiating any provider or controller that depends on it.
2. **Deterministic Startup**: The HTTP server listener (`app.listen()`) is not started until all asynchronous providers have resolved their values.
3. **Fail-Fast Safety**: If the asynchronous factory promise rejects (e.g. the database is unreachable), the application initialization throws an error immediately, preventing the application from starting in an unhealthy or corrupt state.

---

## 3. Injecting Asynchronous Providers

Consuming components inject asynchronous providers using their standard injection token. **The consumer receives the fully resolved value**, not the Promise:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, type DatabaseConnection } from './database.module.js';

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: DatabaseConnection, // Received as resolved instance!
  ) {}

  async findById(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = $1', [id]);
  }
}
```

Notice that `UsersRepository` does not need to handle connection states or await promises in its constructor—the dependency is already connected and ready for use.

---

## 4. Best Practices for Asynchronous Providers

1. **Keep Factories Focused**: The factory should handle connection initialization and authentication only. Complex domain setup belongs in lifecycle hooks (`onModuleInit()`).
2. **Explicit Timeouts**: When connecting to external network resources, configure explicit client timeouts inside the factory to prevent application startup from hanging indefinitely on cold starts.
3. **Graceful Teardown**: Pair asynchronous providers with the host module's `onApplicationShutdown()` lifecycle hook to cleanly terminate pools and release network sockets when the server stops.

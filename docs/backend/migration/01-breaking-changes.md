# Core Breaking Changes & Architectural Shifts

> **Domain**: Breaking Changes, Runtime Diagnostics & Deprecation Mitigations  
> **Framework Compatibility**: NestJS v12.x  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Upgrading an enterprise NestJS codebase from version 11 to version 12 introduces several deliberate breaking changes designed to improve type safety, dependency injection reliability, and modern protocol compliance.

---

## 1. `@Optional()` Is No Longer Inherited by Subclasses

In NestJS 11, if a base class declared an `@Optional()` parameter, derived child classes without their own constructor automatically inherited the optional status. If a dependency was missing, it resolved to `undefined` silently.

In NestJS 12, parameter reflection uses `Reflect.getOwnMetadata`. A subclass that relies on parameter types from a parent class loses the optional annotation, causing NestJS to throw `UnknownDependenciesException` instead of silently passing `undefined`.

### Breaking Code Pattern

```typescript
// Base class with optional logger
export abstract class BaseService {
  constructor(@Optional() protected readonly logger?: LoggerService) {}
}

// v11: Resolved logger as undefined silently
// v12: THROWS UnknownDependenciesException!
@Injectable()
export class UserService extends BaseService {}
```

### Migration Remedy

Explicitly declare the constructor and `@Optional()` decorator on the subclass:

```typescript
@Injectable()
export class UserService extends BaseService {
  constructor(@Optional() logger?: LoggerService) {
    super(logger);
  }
}
```

---

## 2. Terminus Health Indicators: Removal of `HealthCheckError`

The legacy health indicator API deprecated in v11 has been completely removed in v12. Custom health indicators extending `HealthIndicator` or throwing `HealthCheckError` will not compile.

### Legacy v11 Approach (Removed)

```typescript
// DEPRECATED & REMOVED
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  async isHealthy(key: string) {
    const isUp = await this.db.ping();
    const result = this.getStatus(key, isUp);
    if (!isUp) {
      throw new HealthCheckError('DB check failed', result);
    }
    return result;
  }
}
```

### Modern v12 Approach (`HealthIndicatorService`)

In v12, health indicators return state descriptors (`up()`, `down()`, `degraded()`) or delegate execution to `attempt()`:

```typescript
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isHealthy(key: string) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        await this.db.ping();
        return { activeConnections: 12 };
      })
      .withTimeout(1500); // Deprecates { timeout: 1500 } option
  }
}
```

---

## 3. NATS v3 Transporter Modernization

The microservice NATS driver targets NATS v3. The legacy `nats` npm package is unsupported.

### Step 1: Package Swap

```bash
pnpm remove nats
pnpm add @nats-io/transport-node @nats-io/nats-core
```

### Step 2: Code Migration & Deserialization

NATS v3 removed `StringCodec` and `JSONCodec`. Use native JSON decoding and headers from `@nats-io/nats-core`:

```typescript
import * as nats from '@nats-io/nats-core';
import { NatsRecordBuilder } from '@nestjs/microservices';

// 1. Headers construction
const headers = nats.headers();
headers.set('x-correlation-id', crypto.randomUUID());

const record = new NatsRecordBuilder(data).setHeaders(headers).build();
this.client.send('orders.verify', record);

// 2. Custom Deserializers now receive full NATS message object
export class CustomNatsDeserializer {
  deserialize(msg: any) {
    // Read JSON directly instead of manual Uint8Array decoding
    return msg.json();
  }
}
```

---

## 4. GraphQL Subscriptions & GraphiQL Default

1. **`subscriptions-transport-ws` Removed**: The legacy protocol is removed. You must configure `graphql-ws`:
   ```typescript
   GraphQLModule.forRoot<ApolloDriverConfig>({
     driver: ApolloDriver,
     subscriptions: {
       'graphql-ws': true, // Replaces deprecated subscriptions-transport-ws
     },
   });
   ```
2. **GraphiQL is the Default IDE**: Apollo Sandbox/Playground is superseded by GraphiQL. Customize it via the `graphiql` options object:
   ```typescript
   GraphQLModule.forRoot<ApolloDriverConfig>({
     driver: ApolloDriver,
     graphiql: {
       url: '/graphql',
       shouldPersistHeaders: true,
       isHeadersEditorEnabled: true,
     },
   });
   ```

---

## 5. Lifecycle Hook Hierarchy Sequencing

In NestJS 12, lifecycle hooks (`onModuleInit`, `onApplicationBootstrap`, `onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`) are called strictly by **component hierarchy level** rather than arbitrary graph iteration order.

If service A depends on service B in another module, verify initialization sequences to ensure foundational providers complete `onModuleInit` before downstream consumers attempt to read their initialized state.

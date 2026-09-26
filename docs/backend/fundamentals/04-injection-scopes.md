# 04 - Injection Scopes

> **Source Reference**: [NestJS Official Documentation - Injection Scopes](https://docs.nestjs.com/fundamentals/injection-scopes)

In traditional multi-threaded application servers (such as Java Spring or ASP.NET), each incoming request is processed on an independent thread, often requiring per-thread or per-request state. Node.js, by contrast, operates on a **single-threaded event loop**.

In NestJS, almost everything is shared across all incoming requests: database connection pools, singleton services, and application state. Using singleton instances is fully thread-safe in Node.js and delivers optimal throughput and memory efficiency.

However, there are edge cases where a provider's lifetime must be tied to a request or consumer. **Injection scopes** control provider lifecycles.

---

## 1. Provider Scopes Overview

| Scope | Enum Value | Lifetime & Mechanics |
| :--- | :--- | :--- |
| **DEFAULT (Singleton)** | `Scope.DEFAULT` | Instantiated once during application bootstrap and cached. Shared across all consumers and requests. **Strongly recommended for 99% of use cases.** |
| **REQUEST** | `Scope.REQUEST` | A new instance of the provider is created exclusively for **each incoming HTTP request** and garbage-collected after the response is sent. |
| **TRANSIENT** | `Scope.TRANSIENT` | Not shared across consumers. Each consumer that injects a transient provider receives its own dedicated, unshared instance. |

### Declaring Scope
```typescript
import { Injectable, Scope } from '@nestjs/common';

// Request-scoped provider
@Injectable({ scope: Scope.REQUEST })
export class RequestContextService {}

// Transient provider (useful for dedicated loggers)
@Injectable({ scope: Scope.TRANSIENT })
export class ComponentLoggerService {}
```

---

## 2. Scope Bubbling Hazard

> **CRITICAL ARCHITECTURAL RULE**: The `REQUEST` scope bubbles up the dependency injection tree.

```text
ControllerA (Singleton by default)
    │
    ▼ Injects
ServiceB (Singleton by default)
    │
    ▼ Injects
ServiceC (Scope.REQUEST) ──► FORCES ServiceB and ControllerA into Scope.REQUEST!
```

If a low-level service (e.g. `TenantService`) is marked as `Scope.REQUEST`, every service and controller that depends on it—directly or transitively—automatically becomes request-scoped:
* For 10,000 concurrent requests, Nest must instantiate 10,000 ephemeral copies of the controller and all its dependent services.
* This dramatically increases memory allocation and garbage collection churn, reducing server throughput.

> **Transient Scope Difference**: Transient scope does **not** bubble up. If a singleton service injects a transient provider, the singleton receives its own private instance once, and remains a singleton.

---

## 3. The `REQUEST` & `INQUIRER` Built-in Providers

### 1. Inbound Request Object (`REQUEST`)
To access the underlying HTTP request object within a request-scoped provider:

```typescript
import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  logAction(action: string) {
    const ip = this.request.ip;
    console.log(`Action: ${action} from IP: ${ip}`);
  }
}
```

### 2. Inquirer Token (`INQUIRER`)
To determine the parent class in which a transient provider was instantiated:

```typescript
import { Inject, Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class ContextLogger {
  constructor(@Inject(INQUIRER) private readonly parentClass: object) {}

  log(message: string) {
    const contextName = this.parentClass?.constructor?.name ?? 'App';
    console.log(`[${contextName}] ${message}`);
  }
}
```

---

## 4. High-Performance Alternative: `AsyncLocalStorage`

Most use cases that tempt developers to use `Scope.REQUEST` (such as storing the authenticated user ID, tenant ID, or trace correlation ID) can be implemented **without request scoping** using Node.js's native `AsyncLocalStorage`.

Using `AsyncLocalStorage`:
* All services and controllers remain fast, memory-efficient singletons (`Scope.DEFAULT`).
* Request-specific context is propagated asynchronously across promises and async functions automatically.

---

## 5. Multi-Tenant Architecture & Durable Providers

In multi-tenant applications, each customer may have their own database connection pool. Setting the data source provider to `Scope.REQUEST` solves tenant isolation, but re-creates the entire dependency tree for every request.

**Durable Providers** allow grouping requests into shared sub-trees (e.g., 10 tenants = 10 cached sub-trees, rather than 1 sub-tree per request):

### Step 1: Create a Context ID Strategy
```typescript
import {
  type ContextIdStrategy,
  type ContextId,
  ContextIdFactory,
  type HostComponentInfo,
} from '@nestjs/core';
import type { Request } from 'express';

const tenantSubTrees = new Map<string, ContextId>();

export class TenantContextIdStrategy implements ContextIdStrategy {
  attach(contextId: ContextId, request: Request) {
    const tenantId = (request.headers['x-tenant-id'] as string) || 'default';
    let tenantContextId = tenantSubTrees.get(tenantId);

    if (!tenantContextId) {
      tenantContextId = ContextIdFactory.create();
      tenantSubTrees.set(tenantId, tenantContextId);
    }

    return {
      resolve: (info: HostComponentInfo) =>
        info.isTreeDurable ? tenantContextId : contextId,
      payload: { tenantId },
    };
  }
}
```

### Step 2: Register Strategy Globally in `main.ts`
```typescript
import { ContextIdFactory } from '@nestjs/core';
import { TenantContextIdStrategy } from './tenant.strategy.js';

ContextIdFactory.apply(new TenantContextIdStrategy());
```

### Step 3: Flag Providers as Durable
```typescript
@Injectable({ scope: Scope.REQUEST, durable: true })
export class TenantDatabaseService {}
```
Requests from the same tenant now share the same cached durable DI sub-tree, eliminating per-request instantiation overhead while preserving multi-tenant isolation.

# 06 - Module Reference (`ModuleRef`)

> **Source Reference**: [NestJS Official Documentation - Module Reference](https://docs.nestjs.com/fundamentals/module-ref)

The `ModuleRef` class provides programmatic access to the NestJS internal dependency injection container. It allows components to navigate registered providers, resolve instances dynamically using injection tokens, and create new instances on demand.

---

## 1. Injecting `ModuleRef`

`ModuleRef` is provided by `@nestjs/core` and can be injected into any standard provider or controller constructor:

```typescript
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class StrategyRegistryService {
  constructor(private readonly moduleRef: ModuleRef) {}
}
```

---

## 2. Retrieving Static Instances (`get`)

The `get()` method synchronously retrieves a static, singleton provider from the current module:

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PaymentService } from './payment.service.js';

@Injectable()
export class CheckoutService implements OnModuleInit {
  private paymentService!: PaymentService;

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    // Looks up within current module (strict: true by default)
    this.paymentService = this.moduleRef.get(PaymentService);
  }
}
```

### Global Scope Lookup (`strict: false`)
By default, `get()` searches only within the module that hosts the calling class. To search across the global application context (including providers exported by other modules):

```typescript
const globalConfig = this.moduleRef.get(ConfigService, { strict: false });
```

> **Warning**: The `get()` method **cannot** retrieve scoped providers (`Scope.REQUEST` or `Scope.TRANSIENT`). For scoped providers, use `resolve()`.

---

## 3. Resolving Scoped Providers (`resolve`)

Scoped providers must be resolved asynchronously using `resolve()`. Each `resolve()` call without a context identifier instantiates a new isolated DI container sub-tree:

```typescript
@Injectable()
export class TaskWorkerService {
  constructor(private readonly moduleRef: ModuleRef) {}

  async processTask() {
    // Resolves a fresh transient/request-scoped instance
    const scopedService = await this.moduleRef.resolve(ScopedWorkerService);
    await scopedService.execute();
  }
}
```

### Sharing a DI Sub-Tree with `ContextIdFactory`
If multiple scoped providers must share the same context (e.g. sharing a single transactional unit of work):

```typescript
import { ContextIdFactory } from '@nestjs/core';

async executeTransactionalWork() {
  const contextId = ContextIdFactory.create();

  // Both calls resolve within the same DI sub-tree!
  const [serviceA, serviceB] = await Promise.all([
    this.moduleRef.resolve(ServiceA, contextId),
    this.moduleRef.resolve(ServiceB, contextId),
  ]);
}
```

---

## 4. Resolving within an Active Request Context

To resolve an additional request-scoped provider from inside an existing HTTP request (e.g. inside a controller or request-scoped service):

```typescript
import { Injectable, Inject, Scope } from '@nestjs/common';
import { ModuleRef, ContextIdFactory, REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { OrderRepository } from './order.repository.js';

@Injectable({ scope: Scope.REQUEST })
export class OrderService {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly moduleRef: ModuleRef,
  ) {}

  async getRepo(): Promise<OrderRepository> {
    // Obtain the context ID already bound to this HTTP request
    const contextId = ContextIdFactory.getByRequest(this.request);

    // Resolves OrderRepository inside the current request's sub-tree
    return this.moduleRef.resolve(OrderRepository, contextId);
  }
}
```

---

## 5. Dynamically Instantiating Unregistered Classes (`create`)

To dynamically instantiate a class that **was not registered in any module's `providers` array**, while still allowing Nest to inject all of that class's declared dependencies, use `create()`:

```typescript
@Injectable()
export class PluginLoaderService {
  constructor(private readonly moduleRef: ModuleRef) {}

  async loadDynamicPlugin(pluginClass: typeof BasePlugin) {
    // Nest instantiates pluginClass and automatically injects its dependencies
    const pluginInstance = await this.moduleRef.create(pluginClass);
    pluginInstance.init();
    return pluginInstance;
  }
}
```

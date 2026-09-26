# 10 - Discovery Service

> **Source Reference**: [NestJS Official Documentation - Discovery Service](https://docs.nestjs.com/fundamentals/discovery-service)

The `DiscoveryService`, provided by `@nestjs/core`, enables runtime introspection across a NestJS application. It allows scanning, retrieving, and inspecting all registered controllers, providers, and their attached custom metadata at runtime.

---

## 1. When to Use the Discovery Service

The Discovery Service is the foundational building block for:
* **Plugin Architectures**: Discovering dynamic plugins or event consumers without hardcoded module arrays.
* **CQRS Handlers**: Automatically finding command and query handlers annotated with custom decorators.
* **Audit & Compliance Scanners**: Inspecting all registered routes and their permission requirements at startup.
* **Dynamic Cron / Job Registration**: Finding methods decorated with custom job schedules.

---

## 2. Setup & Injection

To use `DiscoveryService`, import `DiscoveryModule` into your module:

```typescript
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PluginScannerService } from './plugin-scanner.service.js';

@Module({
  imports: [DiscoveryModule],
  providers: [PluginScannerService],
})
export class SystemModule {}
```

---

## 3. Discovering Controllers & Providers

Inject `DiscoveryService` and retrieve `InstanceWrapper` objects:

```typescript
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

@Injectable()
export class PluginScannerService implements OnApplicationBootstrap {
  constructor(private readonly discoveryService: DiscoveryService) {}

  onApplicationBootstrap() {
    // Retrieve all registered providers
    const providers = this.discoveryService.getProviders();

    // Retrieve all registered HTTP controllers
    const controllers = this.discoveryService.getControllers();

    console.log(`Discovered ${controllers.length} controllers and ${providers.length} providers.`);
  }
}
```

### Filtering by Module
To limit discovery to specific feature modules:
```typescript
const authProviders = this.discoveryService.getProviders({
  include: [AuthModule],
});
```

---

## 4. Metadata Extraction with Discovery Decorators

`DiscoveryService` pairs with `DiscoveryService.createDecorator()` to tag classes and retrieve them dynamically:

### Step 1: Define a Discovery Decorator
```typescript
// event-subscriber.decorator.ts
import { DiscoveryService } from '@nestjs/core';

export interface EventSubscriberOptions {
  event: string;
}

export const SubscribeEvent = DiscoveryService.createDecorator<EventSubscriberOptions>();
```

### Step 2: Annotate Providers
```typescript
// email.subscriber.ts
import { Injectable } from '@nestjs/common';
import { SubscribeEvent } from './event-subscriber.decorator.js';

@Injectable()
@SubscribeEvent({ event: 'user.registered' })
export class EmailSubscriber {
  handle(payload: unknown) {
    console.log('Sending welcome email:', payload);
  }
}
```

### Step 3: Scan and Register Handlers at Startup
```typescript
// event-bus.service.ts
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { SubscribeEvent } from './event-subscriber.decorator.js';

@Injectable()
export class EventBusService implements OnApplicationBootstrap {
  constructor(private readonly discoveryService: DiscoveryService) {}

  onApplicationBootstrap() {
    // Directly fetch providers tagged with the SubscribeEvent decorator
    const subscribers = this.discoveryService.getProviders({
      metadataKey: SubscribeEvent.KEY,
    });

    for (const wrapper of subscribers) {
      const metadata = this.discoveryService.getMetadataByDecorator(
        SubscribeEvent,
        wrapper,
      );
      console.log(`Registered subscriber for event: ${metadata?.event}`);
    }
  }
}
```
This enables zero-configuration, fully automated component registration.

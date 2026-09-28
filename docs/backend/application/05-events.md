# 05 - Events

> **Source Reference**: [NestJS Official Documentation - Events](https://docs.nestjs.com/application/events)

The Event-Driven Architecture (EDA) pattern provides loose coupling across domain boundaries. When a significant business action occurs (e.g. `order.created` or `user.registered`), the initiating service dispatches an event. Multiple independent domain modules (notifications, analytics, fraud detection, billing) can react to this event without the publisher knowing who is listening.

NestJS provides the `@nestjs/event-emitter` package, built on the high-performance [EventEmitter2](https://github.com/EventEmitter2/EventEmitter2) library.

---

## 1. Installation & Module Setup

```bash
pnpm --filter @aaraj/api add @nestjs/event-emitter
```

Import `EventEmitterModule.forRoot()` into the root `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Set to true to enable namespaces and wildcard listeners
      wildcard: true,
      // Delimiter for event names
      delimiter: '.',
      // Show memory leak warnings if too many listeners attach to one event
      maxListeners: 20,
      verboseMemoryLeak: true,
      // Global module by default: available across all modules
      global: true,
    }),
  ],
})
export class AppModule {}
```

---

## 2. Defining Strongly Typed Events

Create dedicated event classes to guarantee strict typing between event publishers and subscribers:

```typescript
// src/orders/events/order-created.event.ts
export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly totalAmount: number,
    public readonly items: Array<{ sku: string; quantity: number }>,
    public readonly createdAt: Date = new Date(),
  ) {}
}
```

---

## 3. Dispatching (Emitting) Events

Inject `EventEmitter2` into your domain service and dispatch the event instance:

```typescript
// src/orders/orders.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderCreatedEvent } from './events/order-created.event.js';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async createOrder(userId: string, items: Array<{ sku: string; quantity: number }>) {
    const orderId = `ord_${Date.now()}`;
    const totalAmount = items.reduce((acc, item) => acc + item.quantity * 10, 0);

    this.logger.log(`Order created: ${orderId}`, { userId, totalAmount });

    // Emit event asynchronously or synchronously
    this.eventEmitter.emit(
      'order.created',
      new OrderCreatedEvent(orderId, userId, totalAmount, items),
    );

    return { orderId, status: 'PENDING' };
  }
}
```

---

## 4. Subscribing to Events (`@OnEvent`)

Declare event handlers using the `@OnEvent()` decorator on any provider method:

### Synchronous vs. Asynchronous Listeners

```typescript
// src/notifications/notifications.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderCreatedEvent } from '../orders/events/order-created.event.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // Non-blocking asynchronous listener
  @OnEvent('order.created', { async: true })
  async handleOrderCreatedNotification(event: OrderCreatedEvent) {
    this.logger.log(`Dispatching confirmation email for order: ${event.orderId}`);
    // Simulate email dispatch
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
```

### Listener Execution Options

The second argument to `@OnEvent` configures execution behavior:
```typescript
@OnEvent('order.created', {
  async: true,           // Executes handler as an asynchronous Promise
  suppressErrors: true,  // Catches and logs errors instead of halting caller
  prependListener: false // Appends listener to end of invocation chain
})
```

---

## 5. Wildcards and Event Namespaces

When `wildcard: true` is configured in `EventEmitterModule.forRoot()`, listeners can subscribe to entire categories of events:

```typescript
// Single segment wildcard: matches order.created, order.cancelled, order.refunded
@OnEvent('order.*')
handleAllOrderEvents(payload: unknown) {
  this.logger.log('Order domain event received', payload);
}

// Multi-level wildcard: matches order.eu.de.created, order.shipping.intl.delay
@OnEvent('order.**')
handleDeepOrderEvents(payload: unknown) {
  this.logger.log('Deep order event received', payload);
}

// Catch-all auditor: catches EVERY event in the entire application
@OnEvent('**')
handleGlobalAudit(payload: unknown) {
  this.auditService.record(payload);
}
```

---

## 6. Preventing Event Loss During Bootstrap

Event listeners are registered during the `onApplicationBootstrap` lifecycle hook. If your application emits events during module initialization (`onModuleInit` or constructor calls), listeners may not yet be active, causing events to be silently dropped.

To guarantee that all listeners are mounted before emitting startup events, use `EventEmitterReadinessWatcher`:

```typescript
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitterReadinessWatcher } from '@nestjs/event-emitter';

@Injectable()
export class SystemBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly readinessWatcher: EventEmitterReadinessWatcher,
  ) {}

  async onApplicationBootstrap() {
    // Wait until every @OnEvent listener across all modules is registered
    await this.readinessWatcher.waitUntilReady();

    // Safe to emit startup event:
    this.eventEmitter.emit('system.bootstrapped', { timestamp: Date.now() });
  }
}
```

---

## 7. Request-Scoped Listeners

If a listener belongs to a `Scope.REQUEST` provider:
- A new provider instance is created for every event execution.
- If the event payload is the incoming request object (or carries its context ID), enable `inheritRequestContextId: true` in `EventEmitterModule.forRoot()` to reuse the originating request's DI container rather than creating an isolated sub-tree.

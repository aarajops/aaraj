# NestJS Reliability Architecture & Engineering Standards

> **Domain**: System Resilience, Fault Tolerance, Distributed State & Guaranteed Message Delivery  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Reliability in modern distributed systems requires deliberate planning for dependencies that are slow, degraded, or entirely offline. Without systematic fault tolerance, slow downstream services consume request handlers, exhaust connection pools, trigger cascading timeouts, and amplify load through uncoordinated retries. Concurrently, network partitions and cluster restarts risk duplicate processing, data divergence, and dual-write anomalies across relational stores and message brokers.

NestJS provides an integrated suite of official reliability packages designed to solve these challenges with enterprise-grade semantics, unified transport abstractions, and zero external sidecar requirements:

```text
                               INCOMING INGRESS REQUEST
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │         @nestjs/idempotency            │
                     │  (Client Request Deduplication & Lock) │
                     └────────────────────┬───────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │          @nestjs/resilience            │
                     │  (Timeout, Retry, Breaker, Bulkhead)   │
                     └────────────────────┬───────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │       Controller / Domain Service      │
                     │   ┌────────────────────────────────┐   │
                     │   │     DATABASE TRANSACTION (tx)  │   │
                     │   │   • Mutate Domain Entities     │   │
                     │   │   • Outbox.add(tx, messages)   │   │
                     │   └────────────────┬───────────────┘   │
                     └────────────────────┼───────────────────┘
                                          │ (COMMIT)
                                          ▼
                     ┌────────────────────────────────────────┐
                     │            @nestjs/outbox              │
                     │    (Relay Daemon & Consumer Inbox)     │
                     └────────────────────┬───────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │            @nestjs/locks               │
                     │ (Distributed Leases, Leader Elections) │
                     └────────────────────────────────────────┘
```

---

## 1. Reliability Package Matrix

| Package | Decorators & Core APIs | Primary Responsibility | Failure Boundary & Guarantees |
| :--- | :--- | :--- | :--- |
| **[`@nestjs/resilience`](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/01-resilience.md)** | `@Retry()`, `@Timeout()`, `@CircuitBreaker()`, `@Bulkhead()`, `@Fallback()`, `@Resilience()`, `ResilienceService` | Downstream failure containment, circuit breaking, concurrent rate-limiting, and graceful degradation. | Throws standard transport errors (`504 Gateway Timeout`, `503 Service Unavailable`, `RpcException`). Fails fast during outages. |
| **[`@nestjs/idempotency`](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/02-idempotency-keys.md)** | `@Idempotent()`, `IdempotencyStorage`, `IdempotencyStore` | Deduplicating client retries of non-idempotent operations (such as payments or order creation) per IETF specifications. | Locks concurrent identical keys (`409 IDEMPOTENCY_KEY_IN_USE`), replays completed results (`Idempotent-Replayed: true`), encrypts receipts at rest (AES-256-GCM). |
| **[`@nestjs/outbox`](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/03-transactional-outbox.md)** | `Outbox`, `@OnOutboxMessage()`, `OutboxStorage`, `OutboxInbox`, `OutboxDeadLetters` | Eliminating dual-writes by persisting events inside the database transaction of the entity mutation. | Guaranteed at-least-once delivery with guaranteed order per key. Exactly-once consumer processing via transactional inbox tables. |
| **[`@nestjs/locks`](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/04-distributed-locks.md)** | `@OnOneInstance()`, `@WithoutOverlapping()`, `@LeaderElection()`, `Locks.withLock()` | Coordinating single-instance cron execution, preventing overlapping task executions, and managing cluster leader roles. | Distributed leases with monotonic fencing tokens (`fencingToken`) and cooperative `AbortSignal` cancellation upon lease expiration. |

---

## 2. Layering & Interceptor Execution Order

In NestJS, global interceptors execute in an onion-ring order. When combining idempotency, resilience, and business operations, the order of module registration in your root `AppModule` is critical:

```typescript
import { Module } from '@nestjs/common';
import { IdempotencyModule } from '@nestjs/idempotency';
import { ResilienceModule } from '@nestjs/resilience';
import { OutboxModule } from '@nestjs/outbox';
import { LocksModule } from '@nestjs/locks';

@Module({
  imports: [
    // 1. Idempotency MUST be registered before Resilience:
    //    It ensures replays and in-flight 409s exit before any retry or breaker logic triggers.
    //    All retries executed by the server run under a single idempotency lock.
    IdempotencyModule.forRoot({
      scope: (req: { user?: { id: string } }) => req.user?.id,
      ttl: '48h',
      lockTtl: '45s',
      retryAfter: '2s',
    }),

    // 2. Resilience intercepts after idempotency has locked the request:
    //    It manages attempt budgets, backoffs, and circuit breaker trip metrics.
    ResilienceModule.forRoot({
      defaults: {
        timeout: '5s',
        retry: { attempts: 3, backoff: { delay: '200ms', maxDelay: '2s' } },
      },
      presets: {
        carrier: {
          timeout: '2s',
          retry: { attempts: 2 },
          circuitBreaker: { failureRateThreshold: 50, minimumCalls: 10, openDuration: '30s' },
        },
      },
    }),

    // 3. Outbox provides transactional event persistence and relay capabilities:
    OutboxModule.forRoot({
      relay: { enabled: true, pollInterval: '1s', lease: '30s', publishTimeout: '10s' },
    }),

    // 4. Locks provides distributed leases across multi-instance clusters:
    LocksModule.forRoot({
      ttl: '30s',
    }),
  ],
})
export class AppModule {}
```

---

## 3. Reliability Documentation Index

Explore the comprehensive deep-dive guides for each reliability pillar:

1. **[01 - Resilience (`@nestjs/resilience`)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/01-resilience.md)**
   - Stage-by-stage decorator composition (`@Retry()`, `@Timeout()`, `@CircuitBreaker()`, `@Bulkhead()`, `@Fallback()`).
   - Service-level policy execution using `ResilienceService.preset()` and `resilience.create()`.
   - Safe vs. unsafe HTTP method protection and `@Retry({ idempotent: true })`.
   - Cooperative cancellation via `@Signal()` and `AsyncLocalStorage` propagation.
   - Observability via `ResilienceEvents.events$` and `node:diagnostics_channel`.
   - Unit and E2E testing strategies with fake timers.

2. **[02 - Idempotency Keys (`@nestjs/idempotency`)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/02-idempotency-keys.md)**
   - IETF Idempotency-Key specification compliance and request fingerprinting.
   - Scope-based tenant and user isolation (`scope: (req) => req.user?.id`).
   - Atomic Store Contract (`acquire`, `complete`, `release`, `extend`) with owner fencing tokens.
   - Production stores: PostgreSQL (Drizzle ORM & TypeORM) and Redis (atomic Lua scripts).
   - AES-256-GCM zero-downtime key rotation and encrypted receipts at rest.
   - GraphQL mutations, microservice event deduplication, and contract test suites.

3. **[03 - Transactional Outbox (`@nestjs/outbox`)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/03-transactional-outbox.md)**
   - Eliminating the dual-write problem across database tables and message brokers.
   - Transactional event persistence (`outbox.add(tx, messages)`) sharing domain transaction context.
   - Concurrent relay polling with Postgres `SKIP LOCKED` and advisory key locks for ordered commits.
   - Consumer inboxes for deduplication (`@OnOutboxMessage()` and `ctx.processInTransaction(tx, work)`).
   - Multi-transport routing (local in-process and TCP microservices) and dead-letter queue management.
   - Drizzle, TypeORM, and Prisma store implementations.

4. **[04 - Distributed Locks (`@nestjs/locks`)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/reliability/04-distributed-locks.md)**
   - Multi-instance cluster synchronization for scheduled tasks (`@nestjs/schedule`).
   - Single-instance execution with `@OnOneInstance()` and self-concurrency prevention via `@WithoutOverlapping()`.
   - Programmatic locking (`Locks.withLock()`) with ECMAScript explicit resource management (`await using`).
   - Monotonic fencing tokens (`fencingToken`) preventing split-brain writes during GC or network pauses.
   - Cluster leader election (`@LeaderElection()`) with `OnLeadershipAcquired` and `OnLeadershipLost` lifecycles.
   - Postgres and Redis store implementations with contract verification.

---

## 4. Production Reliability Checklist

- [ ] **Import Order**: `IdempotencyModule` must be imported before `ResilienceModule` in the root module.
- [ ] **Shared State in Production**: Always configure shared database or Redis stores for `@nestjs/idempotency`, `@nestjs/outbox`, and `@nestjs/locks`. In-memory stores fail fast at bootstrap when `NODE_ENV=production`.
- [ ] **Cooperative Cancellation**: Always propagate `AbortSignal` (`@Signal()` or `ctx.signal`) to downstream HTTP (`fetch`), database, or RPC calls so timed-out tasks terminate immediately.
- [ ] **Database Connection Pools**: Ensure database connection pools (`pg.Pool` or `drizzle`) are sized appropriately to accommodate background outbox relays, distributed lock heartbeats, and idempotency lock renewals alongside user traffic.
- [ ] **Clock Synchronization**: Keep server clocks synchronized via NTP across all cluster instances to prevent distributed lock lease drift and idempotency expiration discrepancies.
- [ ] **Fencing Token Validation**: On critical storage updates performed under distributed locks, verify that the write condition enforces monotonic fencing (`WHERE fencing_token >= :token`).
- [ ] **Dead-Letter Monitoring**: Set up automated alerting on outbox dead-letter queues (`outbox_dead_letters`) and diagnostics channels (`nestjs:resilience:circuit-open`, `nestjs:locks:lock-lost`).

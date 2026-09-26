# 03 - Transactional Outbox (@nestjs/outbox)

> **Source Reference**: [NestJS Official Documentation - Transactional Outbox](https://docs.nestjs.com/reliability/outbox)

In enterprise architectures, business operations frequently require updating database state and announcing that change as an event to other systems (e.g. saving an order and emitting an `OrderPlaced` event to send an email, allocate inventory, and notify an external analytics service).

Because saving to a database and publishing to a message broker are two distinct network writes, no single distributed transaction spans both systems:
- **Save then Publish**: If the server crashes or the network partitions after the database commit but before the publish, the order exists but the event is lost forever.
- **Publish then Save**: If publishing succeeds but the database insert fails (e.g. constraint violation or lock contention), external consumers react to an order that does not exist.
- **Retry on Failure**: A network timeout after a successful broker write looks like a failure, causing retries that emit duplicate messages and result in duplicate operations.

This is the classic **Dual-Write Problem**. Publishing directly from memory using `ClientProxy.emit()`, `EventEmitter2`, or CQRS `EventBus` inevitably exposes applications to data divergence.

The **Transactional Outbox Pattern** resolves this by converting events into database rows written inside the **exact same database transaction** as the entity mutation. A dedicated background **relay** reads committed messages and dispatches them with exponential backoff, while consumers maintain an **inbox** to guarantee deduplication and idempotency.

---

## 1. Installation & Database Setup

Install `@nestjs/outbox`:

```bash
$ pnpm add @nestjs/outbox
```

### Relational Schema (PostgreSQL with Drizzle ORM)

The pattern requires three coordinated tables:
1. `outbox_messages`: Stores pending and in-flight outgoing events.
2. `outbox_dead_letters`: Stores events that permanently failed or exceeded retry thresholds.
3. `outbox_inbox`: Tracks processed message IDs per consumer to guarantee exactly-once processing.

```typescript
import type { OutboxAttempt, OutboxDeadLetterReason } from '@nestjs/outbox';
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    id: text('id').notNull().unique(), // UUIDv7
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<unknown>(),
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    key: text('key'), // Partition/ordering key (e.g. orderId)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    history: jsonb('history').$type<OutboxAttempt[]>().notNull().default([]),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
  },
  (table) => [index('outbox_messages_key_seq').on(table.key, table.seq)],
);

export const outboxDeadLetters = pgTable(
  'outbox_dead_letters',
  {
    id: text('id').primaryKey(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<unknown>(),
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    key: text('key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull(),
    lastError: text('last_error'),
    history: jsonb('history').$type<OutboxAttempt[]>().notNull(),
    reason: text('reason').$type<OutboxDeadLetterReason>().notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('outbox_dead_letters_topic_failed_at').on(table.topic, table.failedAt)],
);

export const outboxInbox = pgTable(
  'outbox_inbox',
  {
    consumer: text('consumer').notNull(),
    messageId: text('message_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.consumer, table.messageId] }),
    index('outbox_inbox_processed_at').on(table.processedAt),
  ],
);
```

---

## 2. Implementing the Outbox Store

`@nestjs/outbox` defines two storage interfaces: `OutboxStore` (producers & relay) and `OutboxInboxStore` (consumers). A custom provider implements both and registers with `OutboxStorage`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  OutboxStorage,
  OutboxTransactionRequiredError,
  type OutboxClaimRequest,
  type OutboxDeadLetterUpdate,
  type OutboxInboxStore,
  type OutboxMessage,
  type OutboxRescheduleUpdate,
  type OutboxStore,
} from '@nestjs/outbox';
import { and, desc, eq, gt, inArray, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { outboxDeadLetters, outboxInbox, outboxMessages } from './schema.js';

type Transaction = Parameters<Parameters<NodePgDatabase<any>['transaction']>[0]>[0];

const CLAIM_LOCK = 20260901;
const KEY_LOCK = 20260902;

@Injectable()
export class DrizzleOutboxStore implements OutboxStore<Transaction>, OutboxInboxStore<Transaction> {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<any>,
    storage: OutboxStorage,
  ) {
    storage.registerSource({ messages: this, inbox: this });
  }

  async add(tx: Transaction, messages: readonly OutboxMessage[]): Promise<void> {
    if (typeof (tx as any)?.rollback !== 'function') {
      throw new OutboxTransactionRequiredError('Pass the active transaction handle (tx), not the raw db.');
    }
    if (messages.length === 0) return;

    // Preserve commit order: advisory locks ensure sequential identity sequence generation
    for (const lock of this.getKeyLocks(messages)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${KEY_LOCK}::int, ${lock}::int)`);
    }

    await tx.insert(outboxMessages).values(
      messages.map((m) => ({
        id: m.id,
        topic: m.topic,
        payload: m.payload,
        headers: m.headers,
        key: m.key,
        createdAt: new Date(m.createdAt),
        availableAt: new Date(m.availableAt),
      })),
    );
  }

  async claim({ owner, now, leaseMs, limit }: OutboxClaimRequest): Promise<OutboxMessage[]> {
    return this.db.transaction(async (tx) => {
      // Coordinate claimers sequentially
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CLAIM_LOCK}::int, 0)`);

      const at = new Date(now);
      const older = alias(outboxMessages, 'older');

      // Fetch due, unleased messages skipping locked rows
      const due = await tx
        .select({ seq: outboxMessages.seq })
        .from(outboxMessages)
        .where(
          and(
            lte(outboxMessages.availableAt, at),
            or(isNull(outboxMessages.leaseUntil), lte(outboxMessages.leaseUntil, at)),
            or(
              isNull(outboxMessages.key),
              notExists(
                this.db
                  .select({ one: sql`1` })
                  .from(older)
                  .where(
                    and(
                      eq(older.key, outboxMessages.key),
                      lt(older.seq, outboxMessages.seq),
                      or(gt(older.availableAt, at), gt(older.leaseUntil, at)),
                    ),
                  ),
              ),
            ),
          ),
        )
        .orderBy(outboxMessages.seq)
        .limit(limit)
        .for('update', { skipLocked: true });

      if (due.length === 0) return [];
      const seqs = due.map((r) => r.seq);

      await tx
        .update(outboxMessages)
        .set({ leaseOwner: owner, leaseUntil: new Date(now + leaseMs) })
        .where(inArray(outboxMessages.seq, seqs));

      const rows = await tx
        .select()
        .from(outboxMessages)
        .where(inArray(outboxMessages.seq, seqs))
        .orderBy(outboxMessages.seq);

      return rows.map((r) => ({
        id: r.id,
        topic: r.topic,
        payload: r.payload,
        headers: r.headers,
        key: r.key,
        createdAt: r.createdAt.getTime(),
        availableAt: r.availableAt.getTime(),
        attempts: r.attempts,
        lastError: r.lastError,
      }));
    });
  }

  async markPublished(id: string, owner: string): Promise<boolean> {
    const deleted = await this.db
      .delete(outboxMessages)
      .where(and(eq(outboxMessages.id, id), eq(outboxMessages.leaseOwner, owner)))
      .returning({ id: outboxMessages.id });
    return deleted.length === 1;
  }

  async reschedule(id: string, owner: string, update: OutboxRescheduleUpdate): Promise<boolean> {
    const res = await this.db
      .update(outboxMessages)
      .set({
        attempts: update.attempts,
        availableAt: new Date(update.availableAt),
        lastError: update.error.error,
        history: sql`${outboxMessages.history} || ${JSON.stringify([update.error])}::jsonb`,
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(and(eq(outboxMessages.id, id), eq(outboxMessages.leaseOwner, owner)))
      .returning({ id: outboxMessages.id });
    return res.length === 1;
  }

  async deadLetter(id: string, owner: string, update: OutboxDeadLetterUpdate): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(outboxMessages)
        .where(and(eq(outboxMessages.id, id), eq(outboxMessages.leaseOwner, owner)))
        .returning();
      if (!row) return false;

      await tx.insert(outboxDeadLetters).values({
        id: row.id,
        seq: row.seq,
        topic: row.topic,
        payload: row.payload,
        headers: row.headers,
        key: row.key,
        createdAt: row.createdAt,
        attempts: update.attempts,
        lastError: update.error.error,
        history: [...row.history, update.error],
        reason: update.reason,
        failedAt: new Date(update.failedAt),
      });
      return true;
    });
  }

  async recordInbox(tx: Transaction | undefined, consumer: string, messageId: string, now: number): Promise<boolean> {
    const target = tx ?? this.db;
    const inserted = await target
      .insert(outboxInbox)
      .values({ consumer, messageId, processedAt: new Date(now) })
      .onConflictDoNothing()
      .returning({ consumer: outboxInbox.consumer });
    return inserted.length === 1;
  }

  async hasInbox(consumer: string, messageId: string): Promise<boolean> {
    const found = await this.db.$count(
      outboxInbox,
      and(eq(outboxInbox.consumer, consumer), eq(outboxInbox.messageId, messageId)),
    );
    return found > 0;
  }

  private getKeyLocks(messages: readonly OutboxMessage[]): number[] {
    const keys = new Set(messages.flatMap((m) => (m.key === null ? [] : [m.key])));
    return [...keys]
      .map((k) => createHash('sha256').update(k).digest().readInt32BE(0))
      .sort((a, b) => a - b);
  }
}
```

---

## 3. Registering OutboxModule

Register `OutboxModule` in `AppModule` alongside microservice transports:

```typescript
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ClientProxyTransport, OutboxModule } from '@nestjs/outbox';
import { DrizzleOutboxStore } from './database/drizzle-outbox.store.js';

export const ANALYTICS_SERVICE = 'ANALYTICS_SERVICE';

@Module({
  imports: [
    OutboxModule.forRootAsync({
      imports: [
        ClientsModule.register([
          {
            name: ANALYTICS_SERVICE,
            transport: Transport.TCP,
            options: { host: '127.0.0.1', port: 4001 },
          },
        ]),
      ],
      transports: {
        analytics: ClientProxyTransport(ANALYTICS_SERVICE),
      },
      useFactory: () => ({
        // Route topics to specific transports; 'local' runs in-process @OnOutboxMessage() handlers
        route: (msg) => (msg.topic.startsWith('analytics.') ? 'analytics' : 'local'),
        relay: {
          enabled: process.env.OUTBOX_RELAY !== 'off',
          pollInterval: '1s',
          lease: '30s',
          publishTimeout: '10s',
        },
        retry: {
          attempts: 10,
          backoff: { delay: '1s', maxDelay: '1m' },
        },
      }),
    }),
  ],
  providers: [DrizzleOutboxStore],
})
export class AppModule {}
```

---

## 4. Atomic Producer: Saving Orders & Outbox Events

In your domain service, open a database transaction and pass the transaction handle `tx` to both entity inserts and `outbox.add()`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { orders } from '../database/schema.js';

@Injectable()
export class OrdersService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<any>,
    private readonly outbox: Outbox<any>,
  ) {}

  async placeOrder(userId: string, items: any[]): Promise<any> {
    const order = await this.db.transaction(async (tx) => {
      const newOrder = {
        id: randomUUID(),
        userId,
        items,
        total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
        status: 'placed',
      };

      // 1. Insert domain entity into orders table
      await tx.insert(orders).values(newOrder);

      // 2. Insert outbox events into outbox_messages table USING THE SAME tx
      await this.outbox.add(tx, [
        { topic: 'order.placed', payload: newOrder },
        { topic: 'analytics.order.placed', key: newOrder.id, payload: newOrder },
      ]);

      return newOrder;
    });

    // 3. Notify relay to publish immediately rather than waiting for next poll cycle
    this.outbox.notify();

    return order;
  }
}
```

> [!IMPORTANT]
> If any exception occurs inside the transaction callback, both the order and the outbox messages are rolled back atomically. The relay will never see ghost events. Passing the raw database client instead of `tx` throws `OutboxTransactionRequiredError`.

---

## 5. Consumer Handlers & Exactly-Once Semantics

### In-Process Asynchronous Handlers

Use `@OnOutboxMessage()` on provider methods to consume events processed by the local transport:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnOutboxMessage } from '@nestjs/outbox';

@Injectable()
export class OrderEmailsHandler {
  private readonly logger = new Logger(OrderEmailsHandler.name);

  // 'consumer' identifies the inbox entry and MUST remain stable across deploys
  @OnOutboxMessage('order.placed', { consumer: 'order-confirmation-email' })
  async sendConfirmation(order: any) {
    this.logger.log(`Dispatching confirmation email for order ${order.id} to user ${order.userId}`);
  }
}
```

### Transactional Inbox Processing

When a consumer performs mutations within its own database (e.g., deducting inventory), record the message ID **inside the consumer's transaction** using `ctx.processInTransaction()`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { NonRetryableMessageError, OnOutboxMessage, type OutboxHandlerContext } from '@nestjs/outbox';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { products } from '../database/schema.js';

@Injectable()
export class StockReservationHandler {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase<any>) {}

  @OnOutboxMessage('order.placed', { consumer: 'stock-reservation' })
  async reserveStock(order: any, ctx: OutboxHandlerContext<any>) {
    await this.db.transaction(async (tx) => {
      // Atomically inserts inbox record through tx; work runs only if not previously processed
      await ctx.processInTransaction(tx, async () => {
        for (const item of order.items) {
          const res = await tx
            .update(products)
            .set({ inStock: sql`${products.inStock} - ${item.quantity}` })
            .where(and(eq(products.id, item.productId), gte(products.inStock, item.quantity)))
            .returning({ id: products.id });

          if (res.length === 0) {
            // Permanent failure: retrying will not create stock. Moves to dead-letter immediately.
            throw new NonRetryableMessageError(`Insufficient stock for item ${item.productId}`);
          }
        }
      });
    });
  }
}
```

---

## 6. Dead-Letter Queue & Requeue Administration

When an event exceeds configured retry attempts or throws `NonRetryableMessageError`, it moves to `outbox_dead_letters`. You can expose dead-letter management via an admin controller:

```typescript
import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OutboxDeadLetters } from '@nestjs/outbox';

@Controller('admin/outbox/dead-letters')
export class OutboxAdminController {
  constructor(private readonly outboxDeadLetters: OutboxDeadLetters) {}

  @Get()
  list(@Query('topic') topic?: string) {
    return this.outboxDeadLetters.list({ topic });
  }

  @Post(':id/requeue')
  @HttpCode(HttpStatus.OK)
  async requeue(@Param('id') id: string) {
    // Replaces into outbox_messages preserving the original seq and message ID
    const count = await this.outboxDeadLetters.requeue(id);
    return { requeued: count };
  }

  @Delete(':id')
  async purge(@Param('id') id: string) {
    const count = await this.outboxDeadLetters.purge(id);
    return { purged: count };
  }
}
```

---

## 7. Multi-Instance Cluster Scalability

When running multiple replicas of the API:
- **Batch Leasing (`SKIP LOCKED`)**: Replicas claim batches of due messages concurrently. Postgres `FOR UPDATE SKIP LOCKED` guarantees two instances never claim the same row.
- **Fenced Updates**: Every update to `outbox_messages` enforces `WHERE lease_owner = :owner`. If an instance stalls past its lease, a newer instance takes over and the original instance's delayed write is rejected.
- **Order Preservation**: Transactions adding messages with identical partition keys (`key`) serialize acquisition through advisory locks (`pg_advisory_xact_lock`), guaranteeing messages are dispatched in commit order.
- **Dedicated Workers**: Configure `OUTBOX_RELAY=off` on web-serving pods to handle HTTP only, and launch worker pods with `relay.enabled: true` to process outbox publishing without serving user traffic.

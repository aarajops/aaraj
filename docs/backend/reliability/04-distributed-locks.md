# 04 - Distributed Locks (@nestjs/locks)

> **Source Reference**: [NestJS Official Documentation - Distributed Locks](https://docs.nestjs.com/reliability/distributed-locks)

When scaling backend workloads horizontally across multiple cluster replicas, cron schedules defined with `@nestjs/schedule` fire on **every single instance**. Without distributed synchronization:
- An accounting export running nightly at 02:00 runs 3 times across 3 pods, creating triplicate invoices in external ERP systems.
- A warehouse inventory synchronization running every 5 minutes takes 6 minutes during peak catalog loads, causing the subsequent tick to launch a second, overlapping synchronization on another instance and corrupting stock levels.

Naive solutions introduce dangerous race conditions:
- **`RUN_JOBS=true` environment flags**: Break during rolling deployments (where two versions briefly run simultaneously) or when the dedicated worker pod crashes.
- **Unfenced Redis `SET NX` keys**: If an instance experiences a stop-the-world Garbage Collection (GC) pause or network partition longer than the key's TTL, the lock expires. Another instance claims the lock, and when the first instance resumes, both instances write concurrently—unaware of the split-brain state.

`@nestjs/locks` coordinates multi-instance task execution through **distributed leases**. It equips every acquired lock with an `AbortSignal` that cancels work immediately if a lease is lost, and provides a **monotonic fencing token** that increments on every acquisition to reject stale database writes.

---

## 1. Installation & Module Registration

Install `@nestjs/locks`:

```bash
$ pnpm add @nestjs/locks
```

Register `LocksModule` in the root `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { LocksModule } from '@nestjs/locks';
import { DrizzleLockStore } from './database/drizzle-lock.store.js';

@Module({
  imports: [
    LocksModule.forRoot({
      ttl: '30s', // Default lease duration before failover
    }),
  ],
  providers: [DrizzleLockStore],
})
export class AppModule {}
```

---

## 2. Coordinating Scheduled Jobs with Decorators

`@nestjs/locks` provides two high-level decorators for `@Cron()` handlers:

### Run Once Across the Cluster (`@OnOneInstance()`)

Runs the scheduled job on whichever single instance currently holds the lease; all other instances skip the cron tick:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnOneInstance } from '@nestjs/locks';
import { AccountingClient } from './accounting.client.js';

@Injectable()
export class InvoiceExportJob {
  private readonly logger = new Logger(InvoiceExportJob.name);

  constructor(private readonly accountingClient: AccountingClient) {}

  @Cron('0 2 * * *', { name: 'invoice-export', timeZone: 'UTC' })
  @OnOneInstance({ key: 'invoice-export', ttl: '2m' })
  async exportInvoices() {
    this.logger.log('Executing nightly invoice export on the active leader instance...');
    await this.accountingClient.uploadPendingBatches();
  }
}
```

### Prevent Overlapping Executions (`@WithoutOverlapping()`)

If a job takes longer than its cron interval, `@WithoutOverlapping()` skips the subsequent tick across all instances until the in-flight run completes:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnOneInstance, WithoutOverlapping } from '@nestjs/locks';
import { WarehouseClient } from './warehouse.client.js';

@Injectable()
export class StockReconciliationJob {
  private readonly logger = new Logger(StockReconciliationJob.name);

  constructor(private readonly warehouseClient: WarehouseClient) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'stock-reconciliation' })
  @OnOneInstance({ key: 'stock-reconciliation' })
  @WithoutOverlapping({ key: 'stock-reconciliation', ttl: '10m' })
  async reconcileStock() {
    this.logger.log('Reconciling stock levels from warehouse feed...');
    await this.warehouseClient.syncAllCatalogs();
  }
}
```

---

## 3. Monotonic Fencing Tokens & Stale Write Protection

Distributed systems cannot rely on wall-clock time to prevent split-brain writes. If Instance A pauses for 40 seconds (exceeding a 30s TTL), Instance B acquires the lock. When Instance A resumes, it attempts to execute its pending write.

`@nestjs/locks` solves this via **fencing tokens**:

```text
Instance A: Acquires Lock (fencingToken = 101)
Instance A: Enters long GC pause... (Lock expires)
Instance B: Acquires Lock (fencingToken = 102)
Instance B: Writes DB (WHERE last_fencing_token < 102) -> SUCCEEDS (token=102)
Instance A: Wakes up and attempts write (WHERE last_fencing_token < 101) -> FAILS (102 >= 101)
```

### Enforcing Fencing in Domain Repositories

Read the active fencing token from `LocksContext` and guard database updates:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { LocksContext } from '@nestjs/locks';
import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { products } from '../database/schema.js';

@Injectable()
export class StockRepository {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<any>,
    private readonly locksContext: LocksContext,
  ) {}

  async updateStock(productId: string, quantity: number): Promise<boolean> {
    const token = this.locksContext.fencingToken;
    const signal = this.locksContext.signal;

    // 1. Cooperative cancellation check
    if (signal?.aborted) {
      throw new Error('Lock lease was lost before write could complete.');
    }

    // 2. Monotonic fencing check on database write
    const res = await this.db
      .update(products)
      .set({
        inStock: quantity,
        lastFencingToken: token,
      })
      .where(
        and(
          eq(products.id, productId),
          // Reject write if a newer holder already updated the row
          lt(products.lastFencingToken, token),
        ),
      )
      .returning({ id: products.id });

    return res.length === 1;
  }
}
```

---

## 4. Programmatic Locking & Explicit Resource Management

For on-demand or HTTP-triggered operations, use the `Locks` service:

```typescript
import { ConflictException, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Locks } from '@nestjs/locks';
import { InvoiceExportJob } from './invoice-export.job.js';

@Controller('admin/invoices')
export class InvoiceAdminController {
  constructor(
    private readonly locks: Locks,
    private readonly exportJob: InvoiceExportJob,
  ) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  async runManualExport() {
    // Acquire lock or reject immediately if an export is already running
    const lock = await this.locks.acquire('manual-invoice-export', { ttl: '5m', wait: 0 });
    if (!lock) {
      throw new ConflictException('An invoice export is already running in the cluster.');
    }

    try {
      await this.exportJob.exportInvoices();
      return { message: 'Export completed successfully' };
    } finally {
      await lock.release();
    }
  }

  @Post('reconcile')
  async runReconcileWithScope() {
    // Explicit resource management: 'await using' automatically releases lock on scope exit
    await using lock = await this.locks.acquire('stock-reconciliation', { ttl: '3m' });
    if (!lock) throw new ConflictException('Reconciliation already in progress.');

    await this.exportJob.exportInvoices();
  }
}
```

---

## 5. PostgreSQL Database Store (Drizzle ORM)

### Relational Schema

```typescript
import { bigint, pgSequence, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const locksFencingTokenSeq = pgSequence('locks_fencing_token_seq');

export const locks = pgTable('locks', {
  key: text('key').primaryKey(),
  owner: text('owner'),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
```

### Store Implementation

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { LocksStorage, type LockAcquireResult, type LockStore } from '@nestjs/locks';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { locks } from './schema.js';

@Injectable()
export class DrizzleLockStore implements LockStore {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<any>,
    storage: LocksStorage,
  ) {
    storage.registerSource(this);
  }

  async acquire(key: string, owner: string, ttl: number): Promise<LockAcquireResult> {
    const [row] = await this.db
      .insert(locks)
      .values({
        key,
        owner,
        fencingToken: sql`nextval('locks_fencing_token_seq')`,
        expiresAt: sql`clock_timestamp() + ${ttl} * interval '1 millisecond'`,
      })
      .onConflictDoUpdate({
        target: locks.key,
        set: {
          owner,
          fencingToken: sql`greatest(nextval('locks_fencing_token_seq'), ${locks.fencingToken} + 1)`,
          expiresAt: sql`clock_timestamp() + ${ttl} * interval '1 millisecond'`,
        },
        setWhere: sql`${locks.owner} IS NULL OR ${locks.expiresAt} <= clock_timestamp()`,
      })
      .returning({ fencingToken: locks.fencingToken });

    return row ? { acquired: true, fencingToken: row.fencingToken } : { acquired: false };
  }

  async renew(key: string, owner: string, ttl: number): Promise<boolean> {
    const rows = await this.db
      .update(locks)
      .set({ expiresAt: sql`clock_timestamp() + ${ttl} * interval '1 millisecond'` })
      .where(and(eq(locks.key, key), eq(locks.owner, owner), gt(locks.expiresAt, sql`clock_timestamp()`)))
      .returning({ key: locks.key });
    return rows.length === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const rows = await this.db
      .update(locks)
      .set({ owner: null })
      .where(and(eq(locks.key, key), eq(locks.owner, owner)))
      .returning({ key: locks.key });
    return rows.length === 1;
  }
}
```

---

## 6. Cluster Leader Election

For stateful background workloads (such as consuming a continuous WebSocket or TCP hardware feed from a warehouse), exactly one pod must maintain the connection:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LeaderElection, type Lock, type OnLeadershipAcquired, type OnLeadershipLost } from '@nestjs/locks';

@Injectable()
@LeaderElection('warehouse-socket-listener', { ttl: '15s' })
export class WarehouseListenerService implements OnLeadershipAcquired, OnLeadershipLost {
  private readonly logger = new Logger(WarehouseListenerService.name);
  private connection: any;

  async onLeadershipAcquired(lease: Lock) {
    this.logger.log(`Elected cluster leader for warehouse listener (Token: ${lease.fencingToken})`);

    // Abort connection if lease renewal fails
    lease.signal.addEventListener('abort', () => {
      this.closeConnection();
    });

    this.connection = this.openWarehouseSocket();
  }

  onLeadershipLost() {
    this.logger.warn('Leadership lost. Stepping down and closing socket.');
    this.closeConnection();
  }

  private closeConnection() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
  }

  private openWarehouseSocket() {
    // Open persistent socket
    return { close: () => {} };
  }
}
```

---

## 7. Diagnostics Channels & Observability

`@nestjs/locks` emits events on `LocksEvents.events$` and publishes to `node:diagnostics_channel`:

```typescript
import { subscribe } from 'node:diagnostics_channel';

subscribe('nestjs:locks:lock-lost', (msg: any) => {
  console.error(`CRITICAL: Lock '${msg.key}' was lost by holder! Detected by: ${msg.detectedBy}`);
});

subscribe('nestjs:locks:leadership-acquired', (msg: any) => {
  console.info(`Instance acquired leadership for key '${msg.key}'`);
});
```

---

## 8. Technical Reference

### Decorators & Methods

| API | Key Arguments | Primary Purpose |
| :--- | :--- | :--- |
| `@OnOneInstance()` | `{ key, ttl }` | Executes a cron schedule on only one cluster replica at a time. |
| `@WithoutOverlapping()` | `{ key, ttl }` | Skips cron triggers if a previous execution is still running anywhere. |
| `@LeaderElection()` | `key, { ttl }` | Elects an ongoing cluster leader; manages `OnLeadershipAcquired`/`OnLeadershipLost`. |
| `Locks.acquire()` | `key, { ttl, wait, signal }` | Resolves a `Lock` object or `null` if occupied. |
| `Locks.withLock()` | `key, fn, { ttl, wait }` | Executes a scoped callback under a distributed lock and releases automatically. |

### Lock Object Properties

- `key`: The target resource string.
- `owner`: The unique caller UUID fencing token.
- `fencingToken`: Monotonically increasing sequence number for safe database writes.
- `signal`: `AbortSignal` triggered immediately if lease renewal fails.
- `[Symbol.asyncDispose]`: Enables `await using` scope auto-cleanup.

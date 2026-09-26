# 02 - Idempotency Keys (@nestjs/idempotency)

> **Source Reference**: [NestJS Official Documentation - Idempotency Keys](https://docs.nestjs.com/reliability/idempotency)

When a client initiates a sensitive mutation over an unreliable network (e.g. paying for an order from a mobile phone on a train), network dropped connections or timeouts create ambiguity: **did the server charge the card or not?**

If the client retries naively without server-side deduplication, two catastrophic bugs occur:
1. **The first request finished**: The order is already marked `paid`, and the client receives a confusing conflict error for a payment that actually succeeded.
2. **The first request is still running**: Both requests pass the initial `"is order still pending?"` check concurrently, and the user's credit card is charged twice.

An **idempotency key** guarantees that an operation executes exactly once. The client generates a unique key per distinct business decision and transmits it in the `Idempotency-Key` HTTP header. The server executes the handler once, stores the result, and replays that stored response for all subsequent retries. `@nestjs/idempotency` implements this behavior for REST, GraphQL, and microservice transports in strict compliance with the IETF [Idempotency-Key HTTP Header Specification](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/).

---

## 1. Installation & Module Setup

Install `@nestjs/idempotency`:

```bash
$ pnpm add @nestjs/idempotency
```

Register `IdempotencyModule` in the root `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { IdempotencyModule } from '@nestjs/idempotency';
import type { User } from './users/user.entity.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    IdempotencyModule.forRoot({
      // Isolates namespaces per authenticated user. Prevents cross-user collisions.
      scope: (req: { user?: User }) => req.user?.id,
      ttl: '48h',
      lockTtl: '45s',
      retryAfter: '2s',
    }),
    OrdersModule,
  ],
})
export class AppModule {}
```

### Scope-Based Security Isolation

Without `scope`, all clients share a single key namespace. A malicious or accidental duplicate key sent by User B could return User A's cached payment receipt. 

With `scope: (req) => req.user?.id`:
- Alice and Bob can both send `Idempotency-Key: 1` without colliding.
- Because guards execute before interceptors, unauthenticated requests are rejected before reserving or consuming idempotency keys.
- If a shared namespace is deliberately required (such as external webhook callbacks keyed by provider event IDs), configure `scope: false`.

---

## 2. Controller Decorator & Request Lifecycle

Mark mutation endpoints with `@Idempotent()`:

```typescript
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Idempotent } from '@nestjs/idempotency';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PayOrderDto } from './dto/pay-order.dto.js';
import type { User } from '../users/user.entity.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(':id/pay')
  @Idempotent({ required: true })
  pay(
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
    @CurrentUser() user: User,
  ) {
    return this.ordersService.pay(id, user, dto);
  }
}
```

- `required: true`: Rejects incoming requests lacking an `Idempotency-Key` header with `400 Bad Request` (`IDEMPOTENCY_KEY_REQUIRED`) before handler execution.

### Request Execution Flow

```text
Incoming Request + Idempotency-Key: <UUID>
                     │
                     ▼
        Compute Request Fingerprint
     (SHA-256 of Scope + Method + URL + Body)
                     │
                     ▼
          Atomic Store Acquire Lock
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   Lock Acquired?           Key Already Exists?
        │                         │
       YES                        ▼
        │               ┌───────────────────┐
        │               │ Check Lock State  │
        │               └─────────┬─────────┘
        │                         │
        │           ┌─────────────┼─────────────┐
        │           ▼             ▼             ▼
        │       In-Flight     Completed    Fingerprint
        │     (Still Running) (Finished)     Mismatch
        │           │             │             │
        │           ▼             ▼             ▼
        │        HTTP 409      HTTP 2xx      HTTP 422
        │       Retry-After   Idempotent-   IDEMPOTENCY_
        │                     Replayed: true KEY_REUSED
        ▼
   Execute Handler & Renew Lock Every (lockTtl / 3)
        │
        ▼
   Atomic Store Complete (Store Response, Status, Headers)
```

### Allowlisted Replay Headers

When replaying a completed response, `@nestjs/idempotency` replays the status code, the exact body, and specific RFC-allowlisted headers:
- `Location`
- `Content-Type`
- `Content-Language`
- `Content-Location`
- `ETag`
- `Last-Modified`

Transport-specific, authentication, and transient headers (e.g. `Set-Cookie`, `Date`, CORS, rate-limit headers) belong strictly to the immediate connection and are never replayed.

---

## 3. Robust Client-Side Implementation

The server can only deduplicate keys that clients manage consistently:
1. **Generate Once**: The key must be generated when the user initiates the action (e.g. clicks "Pay"), **not** on each network retry. The key must be persisted alongside the pending transaction locally.
2. **Reuse on Transients**: Network timeouts, connection drops, and HTTP `409` (`IDEMPOTENCY_KEY_IN_USE`) or `5xx` responses must be retried with the **exact same key**.
3. **Regenerate on User Decisions**: If a card is declined (`402`) and the user selects a different payment method, generate a brand-new key. Sending an old key with modified payload results in `422 Unprocessable Entity` (`IDEMPOTENCY_KEY_REUSED`).

```typescript
export interface PendingPayment {
  orderId: string;
  paymentMethod: string;
  idempotencyKey: string;
}

export function startPayment(orderId: string, paymentMethod: string): PendingPayment {
  return {
    orderId,
    paymentMethod,
    idempotencyKey: crypto.randomUUID(),
  };
}

export async function submitPayment(
  apiUrl: string,
  token: string,
  payment: PendingPayment,
  maxAttempts = 5,
): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const backoff = 250 * 2 ** (attempt - 1);
    let res: Response;

    try {
      res = await fetch(`${apiUrl}/orders/${payment.orderId}/pay`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': payment.idempotencyKey,
        },
        body: JSON.stringify({ paymentMethod: payment.paymentMethod }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (networkError) {
      if (attempt >= maxAttempts) throw networkError;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (res.ok) {
      return res.json(); // May contain 'Idempotent-Replayed: true' header
    }

    const body = await res.json().catch(() => ({}));
    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      body.code === 'IDEMPOTENCY_KEY_IN_USE';

    if (!retryable || attempt >= maxAttempts) {
      throw new Error(body.message ?? `Payment failed with status ${res.status}`);
    }

    const retryAfter = Number(res.headers.get('Retry-After'));
    await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : backoff));
  }
}
```

---

## 4. The Atomic Store Contract

In production, memory stores (`InMemoryIdempotencyStore`) are prohibited because records are lost on application restarts and are not shared across multiple API replicas. `@nestjs/idempotency` defines the `IdempotencyStore` interface:

```typescript
export interface IdempotencyStore {
  acquire(key: string, owner: string, fingerprint: string, lockTtl: number): Promise<IdempotencyAcquireResult>;
  complete(key: string, owner: string, response: IdempotencyStoredPayload, ttl: number): Promise<boolean>;
  release(key: string, owner: string): Promise<boolean>;
  extend(key: string, owner: string, lockTtl: number): Promise<boolean>;
}
```

- **Fencing Tokens (`owner`)**: Every attempt generates a random UUID fencing token. If an instance stalls or pauses past `lockTtl` and a retry takes over the key, the old instance's delayed `complete()` or `extend()` will fail to match `owner`, preventing stale overwrites.

---

## 5. PostgreSQL Store Implementation (Drizzle ORM)

### Database Schema

```typescript
import type { IdempotencyStoredPayload } from '@nestjs/idempotency';
import { bigint, index, json, pgTable, text } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    // SHA-256 of the record key: keys can be longer than index limits allow.
    keyHash: text('key_hash').primaryKey(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    owner: text('owner'), // null once completed
    // json rather than jsonb to allow \u0000 in raw string responses
    response: json('response').$type<IdempotencyStoredPayload>(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idempotency_keys_expires_at_idx').on(table.expiresAt)],
);
```

### Store Provider

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  IdempotencyStorage,
  type IdempotencyAcquireResult,
  type IdempotencyStore,
  type IdempotencyStoredPayload,
} from '@nestjs/idempotency';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash } from 'node:crypto';
import { idempotencyKeys } from '../database/schema.js';

@Injectable()
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<any>,
    storage: IdempotencyStorage,
  ) {
    // Registers as the official idempotency store at bootstrap
    storage.registerSource(this);
  }

  async acquire(
    key: string,
    owner: string,
    fingerprint: string,
    lockTtl: number,
  ): Promise<IdempotencyAcquireResult> {
    const hash = createHash('sha256').update(key).digest('hex');

    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now();
      const lock = { fingerprint, owner, response: null, expiresAt: now + lockTtl };

      // Atomic Upsert: Inserts if absent OR takes over an expired row
      const taken = await this.db
        .insert(idempotencyKeys)
        .values({ keyHash: hash, key, ...lock })
        .onConflictDoUpdate({
          target: idempotencyKeys.keyHash,
          set: lock,
          setWhere: lte(idempotencyKeys.expiresAt, now),
        })
        .returning({ keyHash: idempotencyKeys.keyHash });

      if (taken.length > 0) {
        return { state: 'acquired' };
      }

      // Someone else holds the lock: inspect their active state
      const [row] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.keyHash, hash));

      if (row && row.expiresAt > now) {
        return row.response === null
          ? { state: 'in-flight', fingerprint: row.fingerprint }
          : { state: 'completed', fingerprint: row.fingerprint, response: row.response };
      }
    }

    throw new Error(`The idempotency record for "${key}" fluctuated concurrently; retry.`);
  }

  async complete(
    key: string,
    owner: string,
    response: IdempotencyStoredPayload,
    ttl: number,
  ): Promise<boolean> {
    const now = Date.now();
    const done = await this.db
      .update(idempotencyKeys)
      .set({ owner: null, response, expiresAt: now + ttl })
      .where(this.ownedBy(key, owner, now))
      .returning({ keyHash: idempotencyKeys.keyHash });
    return done.length === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const released = await this.db
      .delete(idempotencyKeys)
      .where(this.ownedBy(key, owner, Date.now()))
      .returning({ keyHash: idempotencyKeys.keyHash });
    return released.length === 1;
  }

  async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    const now = Date.now();
    const extended = await this.db
      .update(idempotencyKeys)
      .set({ expiresAt: now + lockTtl })
      .where(this.ownedBy(key, owner, now))
      .returning({ keyHash: idempotencyKeys.keyHash });
    return extended.length === 1;
  }

  private ownedBy(key: string, owner: string, now: number) {
    const hash = createHash('sha256').update(key).digest('hex');
    return and(
      eq(idempotencyKeys.keyHash, hash),
      eq(idempotencyKeys.owner, owner),
      gt(idempotencyKeys.expiresAt, now),
    );
  }
}
```

---

## 6. Redis Store Implementation

For high-throughput systems, Redis provides sub-millisecond atomic key management via Lua scripts without database table locks:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  IdempotencyStorage,
  type IdempotencyAcquireResult,
  type IdempotencyStore,
  type IdempotencyStoredPayload,
} from '@nestjs/idempotency';

export interface RedisClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const ACQUIRE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('HSET', KEYS[1], 'state', 'in-flight', 'fp', ARGV[1], 'owner', ARGV[2])
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return {1}
end
local r = redis.call('HMGET', KEYS[1], 'state', 'fp', 'resp')
return {0, r[1], r[2], r[3]}
`;

const COMPLETE_LUA = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'completed', 'resp', ARGV[2])
redis.call('HDEL', KEYS[1], 'owner')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

const RELEASE_LUA = `
if redis.call('HGET', KEYS[1], 'owner') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const EXTEND_LUA = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: RedisClient,
    storage: IdempotencyStorage,
  ) {
    storage.registerSource(this);
  }

  async acquire(key: string, owner: string, fingerprint: string, lockTtl: number): Promise<IdempotencyAcquireResult> {
    const reply = (await this.redis.eval(ACQUIRE_LUA, 1, `idem:${key}`, fingerprint, owner, lockTtl)) as any[];
    if (reply[0] === 1) return { state: 'acquired' };

    const [, state, storedFp, response] = reply;
    return state === 'completed'
      ? { state, fingerprint: storedFp, response: JSON.parse(response) }
      : { state, fingerprint: storedFp };
  }

  async complete(key: string, owner: string, response: IdempotencyStoredPayload, ttl: number): Promise<boolean> {
    const res = await this.redis.eval(COMPLETE_LUA, 1, `idem:${key}`, owner, JSON.stringify(response), ttl);
    return res === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const res = await this.redis.eval(RELEASE_LUA, 1, `idem:${key}`, owner);
    return res === 1;
  }

  async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    const res = await this.redis.eval(EXTEND_LUA, 1, `idem:${key}`, owner, lockTtl);
    return res === 1;
  }
}
```

> [!CAUTION]
> In Redis, ensure `maxmemory-policy` is set to `noeviction`. Evicting active idempotency keys under memory pressure enables double-execution!

---

## 7. Zero-Downtime AES-256-GCM Encryption at Rest

Idempotency stores cache complete HTTP responses, often containing sensitive billing details, card tokens, or PII. Encrypting the payload at rest prevents leaks in database backups:

```typescript
IdempotencyModule.forRootAsync({
  useFactory: () => ({
    scope: (req: { user?: { id: string } }) => req.user?.id,
    encryption: {
      // Primary encryption key listed first; fallback decryption keys follow
      keys: process.env.IDEMPOTENCY_KEYS!.split(','),
    },
    ttl: '48h',
  }),
}),
```

- **Sealed Envelope**: Responses are encrypted with AES-256-GCM as `v1.<keyId>.<iv>.<ciphertext>.<tag>`.
- **Key Rotation**:
  1. Generate a new 32-byte key: `openssl rand -base64 32`.
  2. Deploy with `IDEMPOTENCY_KEYS=oldKey,newKey` (instances encrypt with `oldKey` but decrypt both).
  3. Deploy with `IDEMPOTENCY_KEYS=newKey,oldKey` (new writes encrypt with `newKey`).
  4. After `ttl` (48 hours) has elapsed, prune `oldKey`: `IDEMPOTENCY_KEYS=newKey`.

---

## 8. GraphQL & Microservices Integration

### GraphQL Mutations

In GraphQL, idempotency keys can be provided either in HTTP headers or as an operation argument:

```typescript
@Mutation(() => PaymentReceipt)
@Idempotent({ required: true })
payOrder(
  @Args('orderId', { type: () => ID }) orderId: string,
  @Args('input') input: PayOrderDto,
  @Args('idempotencyKey') _idempotencyKey: string,
  @CurrentUser() user: User,
) {
  return this.ordersService.pay(orderId, user, input);
}
```

- Keys are scoped per mutation field path (e.g. `usr_alice:<key>:payOrder`), allowing multi-operation documents to isolate results.
- In-flight collisions answer with `extensions.code = 'IDEMPOTENCY_KEY_IN_USE'` and `extensions.httpStatus = 409`.

### Microservice Event Deduplication

When message brokers (Kafka, RabbitMQ) deliver events with at-least-once semantics, use `@Idempotent()` on message handlers with `keyFrom`:

```typescript
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Idempotent } from '@nestjs/idempotency';

@Controller()
export class ShippingController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @EventPattern('order.paid')
  @Idempotent({ required: true, keyFrom: { payload: 'eventId' }, ttl: '7d' })
  async handleOrderPaid(@Payload() event: { eventId: string; orderId: string }) {
    await this.shipmentsService.createShipment(event.orderId);
  }
}
```

---

## 9. Technical Reference

### Module Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `required` | `boolean` | `false` | Rejects calls missing an idempotency key with `400 IDEMPOTENCY_KEY_REQUIRED`. |
| `scope` | `Function \| Object \| false` | `undefined` | Namespace isolation function (e.g. user ID). `false` disables scoping. |
| `ttl` | `Duration` | `'24h'` | Expiration TTL for completed response records. |
| `lockTtl` | `Duration` | `'60s'` | Expiration TTL for in-flight locks. Renewed every `lockTtl / 3`. |
| `retryAfter` | `Duration` | `'1s'` | Value of `Retry-After` header returned with HTTP 409 responses. |
| `encryption` | `{ keys: string[] }` | `off` | AES-256-GCM symmetric encryption for response envelopes. |
| `storeIf` | `(status, err) => boolean` | `status < 500` | Condition controlling which execution outcomes are cached and replayed. |

### Error Codes

| Error Code | HTTP Status | Trigger Condition |
| :--- | :--- | :--- |
| `IDEMPOTENCY_KEY_REQUIRED` | `400` | Endpoint marked `required: true` but received without a key. |
| `IDEMPOTENCY_KEY_INVALID` | `400` | Key exceeds 255 chars or contains non-printable characters. |
| `IDEMPOTENCY_KEY_IN_USE` | `409` | A request with this key is currently executing. Includes `Retry-After`. |
| `IDEMPOTENCY_KEY_REUSED` | `422` | Key was submitted with a different URL, method, or payload body. |
| `IDEMPOTENCY_RECORD_UNREADABLE` | `500` | Cached envelope cannot be decrypted (e.g. missing active decryption key). |

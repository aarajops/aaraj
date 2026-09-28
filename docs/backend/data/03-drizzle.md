# 03 - Drizzle ORM Integration

> **Source Reference**: [NestJS Official Documentation - Drizzle](https://docs.nestjs.com/data/drizzle)

[Drizzle ORM](https://orm.drizzle.team/) is a modern, lightweight, TypeScript-first SQL framework. Unlike traditional ORMs that require heavy classes, experimental reflection decorators, or external code generation engines, Drizzle defines tables with plain functions and automatically infers compile-time types from your schema definitions.

The `@nestjs/drizzle` package integrates Drizzle into the NestJS dependency injection graph, offering automated connection pool teardown, replica support, and asynchronous configuration.

---

## 1. Installation & Driver Setup

```bash
# Example for PostgreSQL using node-postgres (pg):
pnpm --filter @aaraj/api add @nestjs/drizzle drizzle-orm pg
pnpm --filter @aaraj/api add -D drizzle-kit @types/pg
```

---

## 2. Declaring Functional Schemas

Define database tables using Drizzle's dialect-specific builders (e.g. `pgTable` for PostgreSQL). Types are inferred using `$inferSelect` and `$inferInsert` without writing separate model classes:

```typescript
// src/db/schema/users.ts
import { pgTable, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  email: text('email').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Infer static TypeScript models directly:
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

---

## 3. Registering the Database Module

Import `DrizzleModule.forRoot()` or `forRootAsync()` into the root `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { relations } from './db/relations.js';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        drizzle,
        connection: config.getOrThrow<string>('DATABASE_URL'),
        relations,
        autoCloseConnection: true, // Closes client when app shuts down
      }),
    }),
  ],
})
export class AppModule {}
```

> **Lifecycle Note**: When `autoCloseConnection: true` is configured, Drizzle's underlying pool client is gracefully terminated during application shutdown or Kubernetes `SIGTERM` signals.

---

## 4. Querying Data with `@InjectDrizzle()`

Unlike TypeORM, Drizzle does not require a `forFeature()` registration step per module. Because Drizzle tables are plain objects, you import them directly into your service and query using the injected database client:

```typescript
// src/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users, type User, type NewUser } from '../db/schema/users.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
  ) {}

  async findAll(): Promise<User[]> {
    return this.db.select().from(users).where(eq(users.isActive, true));
  }

  async findById(id: number): Promise<User> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  async create(newUser: NewUser): Promise<User> {
    const [created] = await this.db
      .insert(users)
      .values(newUser)
      .returning();

    return created;
  }

  async deactivate(id: number): Promise<void> {
    await this.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, id));
  }
}
```

---

## 5. Relational Queries API (`defineRelations`)

For nested reads without writing manual joins, define schema relations using `defineRelations()`:

```typescript
// src/db/relations.ts
import { defineRelations } from 'drizzle-orm';
import { users } from './schema/users.js';
import { posts } from './schema/posts.js';

export const relations = defineRelations({ users, posts }, (r) => ({
  users: {
    posts: r.many.posts(),
  },
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
    }),
  },
}));
```

Pass the `relations` object to `DrizzleModule.forRoot({ relations, ... })`. You can now use the type-safe `db.query` relational API:

```typescript
async findUserWithPosts(id: number) {
  return this.db.query.users.findFirst({
    where: { id },
    with: {
      posts: {
        where: { published: true },
        limit: 10,
      },
    },
  });
}
```

---

## 6. Atomic Database Transactions

Call `db.transaction()` to execute multi-table mutations atomically:

```typescript
async transferFunds(fromUserId: number, toUserId: number, amount: number) {
  await this.db.transaction(async (tx) => {
    // Queries within transaction MUST run through 'tx', not this.db:
    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} - ${amount}` })
      .where(eq(accounts.userId, fromUserId));

    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${amount}` })
      .where(eq(accounts.userId, toUserId));

    await tx.insert(auditLogs).values({
      type: 'TRANSFER',
      from: fromUserId,
      to: toUserId,
      amount,
    });
  });
}
```

If any query throws inside the callback, Drizzle automatically executes a `ROLLBACK` and bubbles the error up.

---

## 7. Read Replicas Routing (`withReplicas`)

For high-scale architectures routing read queries to replica databases and mutations to the primary:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { withReplicas } from 'drizzle-orm/pg-core';

DrizzleModule.forRootAsync({
  useFactory: () => ({
    db: withReplicas(
      drizzle(process.env.PRIMARY_DATABASE_URL!), // Primary for INSERT/UPDATE/DELETE
      [drizzle(process.env.REPLICA_DATABASE_URL!)], // Replicas for SELECT queries
    ),
  }),
})
```

---

## 8. Schema Migrations with Drizzle Kit

Drizzle Kit is a CLI companion for generating and executing versioned SQL migrations.

### Configuration (`drizzle.config.ts`)

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Migration Workflow Commands

```bash
# 1. Generate SQL migration files from TypeScript schema differences
npx drizzle-kit generate

# 2. Apply pending SQL migrations to the database
npx drizzle-kit migrate

# 3. Launch interactive database browser UI
npx drizzle-kit studio
```

---

## 9. Unit Testing & Mocking Drizzle

Use the `getDrizzleToken()` function to inject mock databases in unit tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDrizzleToken } from '@nestjs/drizzle';
import { UsersService } from './users.service.js';

describe('UsersService (Drizzle)', () => {
  let service: UsersService;

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 1, email: 'test@aaraj.io' }]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1, email: 'created@aaraj.io' }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getDrizzleToken(),
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should query active users', async () => {
    const users = await service.findAll();
    expect(users).toHaveLength(1);
    expect(mockDb.select).toHaveBeenCalled();
  });
});
```

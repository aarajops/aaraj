# 04 - Prisma ORM Integration

> **Source Reference**: [NestJS Official Documentation - Prisma](https://docs.nestjs.com/data/prisma)

[Prisma](https://www.prisma.io/) is an open-source next-generation Object-Relational Mapper (ORM) that consists of:
1. **Prisma Schema (`schema.prisma`)**: A single human-readable declarative modeling language for defining database tables and relations.
2. **Prisma Client**: An auto-generated, type-safe query engine generated directly from your schema.
3. **Prisma Migrate**: A declarative database migration system.
4. **Prisma Studio**: An interactive visual database GUI.

Unlike TypeORM or Drizzle, there is no official `@nestjs/prisma` wrapper package because Prisma does not require one. You expose the generated `PrismaClient` directly through an injectable NestJS provider (`PrismaService`).

---

## 1. Installation & CLI Initialization

```bash
# Install runtime client:
pnpm --filter @araz/api add @prisma/client

# Install development CLI:
pnpm --filter @araz/api add -D prisma
```

Initialize Prisma in the project:
```bash
npx prisma init
```

This creates a `prisma/schema.prisma` file and a `.env` database connection template.

---

## 2. Defining the Schema (`schema.prisma`)

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  firstName String
  lastName  String
  isActive  Boolean  @default(true)
  orders    Order[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

model Order {
  id          String   @id @default(uuid())
  totalAmount Float
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@map("orders")
}
```

Generate the typed client:
```bash
npx prisma generate
```

---

## 3. Implementing `PrismaService` & Lifecycle Hooks

Create a singleton `PrismaService` that extends `PrismaClient` and connects/disconnects with the NestJS application lifecycle:

```typescript
// src/prisma/prisma.service.ts
import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    this.logger.log('Connecting to database via Prisma Client...');
    await this.$connect();
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting database client...');
    await this.$disconnect();
  }
}
```

### Encapsulating in a Global `PrismaModule`

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Import `PrismaModule` once into `AppModule`. Because it is marked `@Global()`, any service in the application can inject `PrismaService` without re-importing `PrismaModule`.

---

## 4. Consuming Prisma in Services

```typescript
// src/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { isActive: true },
      include: { orders: true }, // Eager load relational orders
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async deactivate(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
```

---

## 5. ACID Transactions in Prisma

Prisma supports both sequential batch transactions and interactive transactions:

### Interactive Transactions (`$transaction`)

```typescript
async transferFunds(fromId: string, toId: string, amount: number) {
  return this.prisma.$transaction(async (tx) => {
    // 1. Decrement sender balance
    const sender = await tx.account.update({
      data: { balance: { decrement: amount } },
      where: { id: fromId },
    });

    if (sender.balance < 0) {
      throw new Error(`Insufficient funds for account ${fromId}`);
    }

    // 2. Increment receiver balance
    const recipient = await tx.account.update({
      data: { balance: { increment: amount } },
      where: { id: toId },
    });

    // 3. Record audit transaction log
    await tx.transferLog.create({
      data: { fromId, toId, amount },
    });

    return { sender, recipient };
  });
}
```

---

## 6. Client Extensions (`$extends`)

Prisma Client Extensions allow you to attach custom methods, computed fields, and query interceptors (e.g. transparent soft-delete filtering):

```typescript
// Soft-delete extension example
const extendedClient = prisma.$extends({
  query: {
    user: {
      async findMany({ args, query }) {
        args.where = { ...args.where, isActive: true };
        return query(args);
      },
    },
  },
});
```

---

## 7. Unit Testing Prisma Services

In unit tests, mock `PrismaService` methods using Vitest:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('UsersService (Prisma)', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: '1', email: 'alex@araz.io' }]),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should return active users', async () => {
    const users = await service.findAll();
    expect(users).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalled();
  });
});
```

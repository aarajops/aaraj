# 02 - TypeORM Integration

> **Source Reference**: [NestJS Official Documentation - TypeORM](https://docs.nestjs.com/data/typeorm)

TypeORM is one of the most mature Object-Relational Mappers (ORMs) in the TypeScript ecosystem. It supports the **Repository** and **Active Record** patterns and integrates with major relational databases (PostgreSQL, MySQL, SQLite, MSSQL, Oracle) as well as MongoDB.

The `@nestjs/typeorm` package provides first-class NestJS integration, including dependency-injected repositories, connection lifecycle handling, and automated transaction orchestration.

---

## 1. Installation & Module Setup

```bash
# Example for PostgreSQL:
pnpm --filter @aaraj/api add @nestjs/typeorm typeorm pg
pnpm --filter @aaraj/api add -D @types/pg
```

### Basic Setup in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'postgres'),
        password: config.get<string>('DATABASE_PASSWORD', 'secret'),
        database: config.get<string>('DATABASE_NAME', 'aaraj_db'),
        autoLoadEntities: true, // Automatically registers entities loaded via forFeature
        synchronize: false,    // CRITICAL: NEVER enable in production! Data loss risk!
        retryAttempts: 10,
        retryDelay: 3000,
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),
  ],
})
export class AppModule {}
```

> **Warning (`synchronize: true`)**: The `synchronize` option automatically syncs entity changes directly with the database schema by dropping or altering tables. This is convenient for throwaway local sandboxes, but **catastrophic in production**. Always set `synchronize: false` and use version-controlled **migrations**.

---

## 2. Entities & The Repository Pattern

### Defining an Entity Class

```typescript
// src/users/entities/user.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => Order, (order) => order.user)
  orders!: Order[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

### Registering Entities with `forFeature`

Within domain feature modules, register entities using `TypeOrmModule.forFeature([Entity])`:

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [TypeOrmModule], // Export to allow other modules to inject UserRepository
})
export class UsersModule {}
```

### Injecting the Repository

Inject the typed repository into your service using `@InjectRepository(Entity)`:

```typescript
// src/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      where: { isActive: true },
      relations: ['orders'],
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.userRepository.create(userData);
    return this.userRepository.save(user);
  }

  async deactivate(id: string): Promise<void> {
    await this.userRepository.update(id, { isActive: false });
  }
}
```

---

## 3. Relationships & Associations

| Relationship | Decorators | Example Syntax |
| :--- | :--- | :--- |
| **One-to-One** | `@OneToOne()`, `@JoinColumn()` | `@OneToOne(() => Profile, p => p.user) @JoinColumn() profile: Profile;` |
| **Many-to-One** | `@ManyToOne()` | `@ManyToOne(() => User, u => u.orders) user: User;` |
| **One-to-Many** | `@OneToMany()` | `@OneToMany(() => Order, o => o.user) orders: Order[];` |
| **Many-to-Many** | `@ManyToMany()`, `@JoinTable()` | `@ManyToMany(() => Role) @JoinTable() roles: Role[];` |

---

## 4. ACID Database Transactions

When mutating multiple database entities atomically (e.g. creating an order, updating inventory, and logging an audit event), use transactions to ensure all steps succeed or all rollback.

### Approach A: Manual Control via `QueryRunner` (Recommended)

`QueryRunner` provides complete lifecycle control over connection acquisition, transaction isolation, and rollback:

```typescript
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class CheckoutService {
  constructor(private readonly dataSource: DataSource) {}

  async executeCheckout(userId: string, items: Array<{ id: string; qty: number }>) {
    const queryRunner = this.dataSource.createQueryRunner();

    // 1. Establish dedicated database connection from pool
    await queryRunner.connect();
    // 2. Begin explicit transaction
    await queryRunner.startTransaction();

    try {
      // Perform database operations using queryRunner.manager:
      const order = await queryRunner.manager.save(Order, { userId, total: 100 });
      await queryRunner.manager.decrement(Inventory, { itemId: items[0].id }, 'stock', 1);

      // 3. Commit atomic transaction
      await queryRunner.commitTransaction();
      return order;
    } catch (error) {
      // 4. Rollback all operations on failure
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Checkout failed; transaction rolled back');
    } finally {
      // 5. CRITICAL: Release connection back to pool to prevent socket leaks!
      await queryRunner.release();
    }
  }
}
```

### Approach B: Callback-Style `dataSource.transaction()`

For simpler workflows, the callback automatically commits upon return or rolls back on thrown errors:

```typescript
await this.dataSource.transaction(async (manager) => {
  await manager.save(user);
  await manager.save(profile);
});
```

---

## 5. Entity Subscribers (Event Hooks)

TypeORM subscribers listen to entity lifecycle events (`beforeInsert`, `afterInsert`, `beforeUpdate`, `beforeRemove`):

```typescript
// src/users/subscribers/user.subscriber.ts
import {
  EventSubscriber,
  type EntitySubscriberInterface,
  type InsertEvent,
  DataSource,
} from 'typeorm';
import { User } from '../entities/user.entity.js';

@EventSubscriber()
export class UserSubscriber implements EntitySubscriberInterface<User> {
  constructor(dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return User;
  }

  beforeInsert(event: InsertEvent<User>) {
    event.entity.email = event.entity.email.toLowerCase().trim();
  }
}
```

> **Warning**: Event subscribers **cannot be request-scoped**. They are singletons registered directly with the global `DataSource`.

---

## 6. Multiple Databases & Named Connections

If an application connects to multiple databases (e.g. primary transactional DB and historical analytics DB):

```typescript
@Module({
  imports: [
    TypeOrmModule.forRoot({
      // Default connection
      type: 'postgres',
      host: 'primary-db',
      entities: [User, Order],
    }),
    TypeOrmModule.forRoot({
      name: 'analyticsConnection', // Named connection
      type: 'postgres',
      host: 'analytics-db',
      entities: [LogEvent],
    }),
  ],
})
export class AppModule {}
```

Injecting the named repository:
```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([LogEvent], 'analyticsConnection'),
  ],
})
export class AnalyticsModule {}
```

In the service:
```typescript
constructor(
  @InjectRepository(LogEvent, 'analyticsConnection')
  private readonly logsRepo: Repository<LogEvent>,
  @InjectDataSource('analyticsConnection')
  private readonly analyticsDataSource: DataSource,
) {}
```

---

## 7. Unit Testing & Mocking Repositories

When unit testing services, avoid connecting to a live database. Use `getRepositoryToken(Entity)` to provide mock implementations:

```typescript
// src/users/users.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { User } from './entities/user.entity.js';

describe('UsersService', () => {
  let service: UsersService;

  const mockUserRepository = {
    find: vi.fn().mockResolvedValue([{ id: '1', email: 'test@aaraj.io' }]),
    findOneBy: vi.fn(),
    create: vi.fn().mockImplementation((dto) => dto),
    save: vi.fn().mockImplementation((user) => Promise.resolve({ id: '1', ...user })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should find all active users', async () => {
    const users = await service.findAll();
    expect(users).toHaveLength(1);
    expect(mockUserRepository.find).toHaveBeenCalled();
  });
});
```

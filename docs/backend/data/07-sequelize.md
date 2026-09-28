# 07 - Sequelize Integration

> **Source Reference**: [NestJS Official Documentation - Sequelize](https://docs.nestjs.com/data/sequelize)

[Sequelize](https://sequelize.org/) is a battle-tested, promise-based Node.js ORM for PostgreSQL, MySQL, MariaDB, SQLite, and Microsoft SQL Server. Combined with the `sequelize-typescript` package, models are declared using TypeScript classes and decorators.

The `@nestjs/sequelize` package integrates Sequelize into NestJS, offering model injection, transaction propagation, and async module configuration.

---

## 1. Installation & Driver Setup

```bash
# Example for PostgreSQL:
pnpm --filter @aaraj/api add @nestjs/sequelize sequelize sequelize-typescript pg
pnpm --filter @aaraj/api add -D @types/sequelize @types/pg
```

### Module Registration in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres',
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'postgres'),
        password: config.get<string>('DATABASE_PASSWORD', 'secret'),
        database: config.get<string>('DATABASE_NAME', 'aaraj_db'),
        autoLoadModels: true, // Automatically registers models loaded via forFeature
        synchronize: false,   // Never synchronize in production!
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 2. Declaring Models with `sequelize-typescript`

Models extend `Model<T>` and declare columns and associations with decorators:

```typescript
// src/users/models/user.model.ts
import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { Order } from '../../orders/models/order.model.js';

@Table({ tableName: 'users', timestamps: true })
export class User extends Model<User> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  override id!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  email!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  firstName!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  lastName!: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  isActive!: boolean;

  @HasMany(() => Order)
  orders!: Order[];
}
```

---

## 3. Registering Models with `forFeature`

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './models/user.model.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [SequelizeModule.forFeature([User])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [SequelizeModule],
})
export class UsersModule {}
```

---

## 4. Injecting & Querying Models

In Sequelize, the Model class itself serves as the query repository. Inject it using `@InjectModel(Model)`:

```typescript
// src/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from './models/user.model.js';
import { Order } from '../../orders/models/order.model.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userModel.findAll({
      where: { isActive: true },
      include: [Order],
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userModel.findByPk(id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  async create(userData: Partial<User>): Promise<User> {
    return this.userModel.create(userData as any);
  }

  async deactivate(id: string): Promise<void> {
    const user = await this.findById(id);
    await user.update({ isActive: false });
  }
}
```

---

## 5. Managed Database Transactions

Sequelize provides automated managed transactions that commit on function resolution or roll back on errors:

```typescript
import { Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';

@Injectable()
export class CheckoutService {
  constructor(private readonly sequelize: Sequelize) {}

  async executeCheckout(orderData: any, paymentData: any) {
    // Automatically commits if promise resolves, rolls back if throws
    return this.sequelize.transaction(async (transaction) => {
      const order = await this.orderModel.create(orderData, { transaction });
      await this.paymentModel.create({ ...paymentData, orderId: order.id }, { transaction });
      return order;
    });
  }
}
```

---

## 6. Unit Testing with `getModelToken`

Mock Sequelize models in unit tests using `getModelToken(Model)`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { UsersService } from './users.service.js';
import { User } from './models/user.model.js';

describe('UsersService (Sequelize)', () => {
  it('should find all users', async () => {
    const mockUserModel = {
      findAll: vi.fn().mockResolvedValue([{ id: '1', email: 'test@aaraj.io' }]),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User), useValue: mockUserModel },
      ],
    }).compile();

    const service = module.get<UsersService>(UsersService);
    const users = await service.findAll();
    expect(users).toHaveLength(1);
    expect(mockUserModel.findAll).toHaveBeenCalled();
  });
});
```

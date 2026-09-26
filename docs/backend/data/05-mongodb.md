# 05 - MongoDB & Mongoose Integration

> **Source Reference**: [NestJS Official Documentation - MongoDB (Mongoose)](https://docs.nestjs.com/data/mongodb)

[MongoDB](https://www.mongodb.com/) is a leading document-oriented NoSQL database. Instead of relational tables and foreign keys, MongoDB stores semi-structured BSON documents with dynamic schemas.

The `@nestjs/mongoose` package integrates [Mongoose](https://mongoosejs.com/) (the Object Data Modeling library for MongoDB) into NestJS, providing decorator-based schema definition, dependency-injected models, and automated lifecycle handling.

---

## 1. Installation & Module Setup

```bash
pnpm --filter @araz/api add @nestjs/mongoose mongoose
pnpm --filter @araz/api add -D @types/mongoose
```

### Basic Setup in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 2. Defining Schemas with Decorators

Mongoose schemas in NestJS are declared using class decorators:

```typescript
// src/cats/schemas/cat.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

export type CatDocument = HydratedDocument<Cat>;

@Schema({ timestamps: true, collection: 'cats' })
export class Cat {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, min: 0 })
  age!: number;

  @Prop({ required: true })
  breed!: string;

  @Prop({ default: [] })
  tags!: string[];
}

export const CatSchema = SchemaFactory.createForClass(Cat);
```

### Decorators Overview:
- `@Schema(options)`: Configures collection names, timestamps, and schema options.
- `@Prop(options)`: Declares document properties with validation (`required`, `enum`, `default`, `index`).

---

## 3. Registering Models with `forFeature`

Register the schema with Mongoose inside the feature module:

```typescript
// src/cats/cats.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cat, CatSchema } from './schemas/cat.schema.js';
import { CatsService } from './cats.service.js';
import { CatsController } from './cats.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cat.name, schema: CatSchema }]),
  ],
  providers: [CatsService],
  controllers: [CatsController],
  exports: [MongooseModule],
})
export class CatsModule {}
```

---

## 4. Injecting & Querying the Model

Inject the Mongoose `Model` using the `@InjectModel(Cat.name)` decorator:

```typescript
// src/cats/cats.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cat, type CatDocument } from './schemas/cat.schema.js';

@Injectable()
export class CatsService {
  constructor(
    @InjectModel(Cat.name)
    private readonly catModel: Model<CatDocument>,
  ) {}

  async findAll(): Promise<Cat[]> {
    // Always call .exec() on Mongoose queries to return native Promises
    return this.catModel.find().exec();
  }

  async findById(id: string): Promise<Cat> {
    const cat = await this.catModel.findById(id).exec();
    if (!cat) {
      throw new NotFoundException(`Cat #${id} not found`);
    }
    return cat;
  }

  async create(createCatDto: Partial<Cat>): Promise<Cat> {
    const createdCat = new this.catModel(createCatDto);
    return createdCat.save();
  }

  async delete(id: string): Promise<void> {
    await this.catModel.findByIdAndDelete(id).exec();
  }
}
```

> **Critical Note on `.exec()`**: Mongoose query methods (e.g. `find()`, `findById()`) return a Mongoose `Query` object, not a standard Promise. Always append `.exec()` to ensure predictable async behavior and complete stack traces.

---

## 5. Subdocuments & Nested Schemas

When nesting complex document structures inside a parent document:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class Address {
  @Prop({ required: true })
  street!: string;

  @Prop({ required: true })
  city!: string;
}

export const AddressSchema = SchemaFactory.createForClass(Address);

@Schema()
export class Owner {
  @Prop({ required: true })
  name!: string;

  // Embedded subdocument
  @Prop({ type: AddressSchema, required: true })
  address!: Address;
}
```

---

## 6. MongoDB Replica Set Transactions

MongoDB supports multi-document ACID transactions across replica sets:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class OrdersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async processOrder(orderData: unknown) {
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        // Multi-document operations must pass { session }
        await this.orderModel.create([orderData], { session });
        await this.inventoryModel.updateOne(
          { itemId: '101' },
          { $inc: { stock: -1 } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
}
```

---

## 7. Unit Testing Mongoose Models

Use `getModelToken(ModelName)` to mock Mongoose models in unit tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CatsService } from './cats.service.js';
import { Cat } from './schemas/cat.schema.js';

describe('CatsService (Mongoose)', () => {
  let service: CatsService;

  const mockCatModel = {
    find: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ name: 'Mittens', age: 3 }]),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatsService,
        {
          provide: getModelToken(Cat.name),
          useValue: mockCatModel,
        },
      ],
    }).compile();

    service = module.get<CatsService>(CatsService);
  });

  it('should find all cats', async () => {
    const cats = await service.findAll();
    expect(cats).toHaveLength(1);
  });
});
```

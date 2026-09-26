# 06 - MikroORM Integration

> **Source Reference**: [NestJS Official Documentation - MikroORM](https://docs.nestjs.com/data/mikroorm)

[MikroORM](https://mikro-orm.io/) is a TypeScript ORM based on the **Data Mapper**, **Unit of Work**, and **Identity Map** patterns (similar to Doctrine 2 and Hibernate).

Unlike traditional Active Record ORMs where entities are tightly coupled to the database, MikroORM entities are pure TypeScript domain models. The Unit of Work automatically tracks all changes to entities and synchronizes them to the database in a single optimized transaction during `em.flush()`.

The `@mikro-orm/nestjs` package (maintained directly by the MikroORM core team) provides first-class NestJS integration.

---

## 1. Installation & Module Setup

```bash
# Example for PostgreSQL:
pnpm --filter @araz/api add @mikro-orm/core @mikro-orm/postgresql @mikro-orm/nestjs
```

### Module Registration in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      driver: PostgreSqlDriver,
      dbName: 'araz_db',
      clientUrl: process.env.DATABASE_URL,
      autoLoadEntities: true, // Loads entities registered via forFeature
      debug: process.env.NODE_ENV === 'development',
    }),
  ],
})
export class AppModule {}
```

---

## 2. Defining Domain Entities

MikroORM uses entity decorators. Entities do not need to extend any base class:

```typescript
// src/authors/entities/author.entity.ts
import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  Collection,
  Cascade,
} from '@mikro-orm/core';
import { Book } from './book.entity.js';

@Entity()
export class Author {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Property({ unique: true })
  email!: string;

  @OneToMany(() => Book, (book) => book.author, { cascade: [Cascade.ALL] })
  books = new Collection<Book>(this);

  constructor(name: string, email: string) {
    this.name = name;
    this.email = email;
  }
}
```

```typescript
// src/authors/entities/book.entity.ts
import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { Author } from './author.entity.js';

@Entity()
export class Book {
  @PrimaryKey()
  id!: number;

  @Property()
  title!: string;

  @ManyToOne(() => Author)
  author!: Author;

  constructor(title: string, author: Author) {
    this.title = title;
    this.author = author;
  }
}
```

---

## 3. Registering Feature Entities

```typescript
// src/authors/authors.module.ts
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Author } from './entities/author.entity.js';
import { Book } from './entities/book.entity.js';
import { AuthorsService } from './authors.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([Author, Book])],
  providers: [AuthorsService],
  exports: [AuthorsService],
})
export class AuthorsModule {}
```

---

## 4. Request Context & The Identity Map

Because MikroORM maintains an in-memory **Identity Map** (which tracks and caches entity instances during a unit of work), sharing a single `EntityManager` across multiple concurrent HTTP requests leads to data corruption and memory leaks.

### Automatic Context Forking Middleware
The `@mikro-orm/nestjs` package automatically registers a global middleware that forks a new `EntityManager` for each incoming HTTP request using Node's `AsyncLocalStorage`:

```typescript
// Any service simply injects EntityManager; it is guaranteed to be forked for this request:
@Injectable()
export class AuthorsService {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(Author)
    private readonly authorRepo: EntityRepository<Author>,
  ) {}

  async createAuthorWithBooks(name: string, email: string, bookTitles: string[]) {
    const author = new Author(name, email);

    for (const title of bookTitles) {
      author.books.add(new Book(title, author));
    }

    // Tell Unit of Work to manage this new entity
    this.em.persist(author);

    // Flush all pending changes in a single atomic SQL transaction
    await this.em.flush();

    return author;
  }
}
```

---

## 5. Unit of Work Mutations & `flush()`

Unlike traditional ORMs where you call `save()` on every entity separately:
1. `em.persist(entity)`: Informs the Unit of Work that an entity is managed. No SQL queries are executed yet.
2. `em.flush()`: Calculates all dirty entities, resolves dependency order, and executes all `INSERT`, `UPDATE`, and `DELETE` statements inside a single transaction.

```typescript
async updateAuthor(id: number, newName: string) {
  const author = await this.authorRepo.findOneOrFail({ id });
  
  // Simply mutate entity properties:
  author.name = newName;

  // MikroORM automatically detects dirty properties!
  await this.em.flush();
}
```

---

## 6. Transactions

To execute operations within a database transaction:

```typescript
await this.em.transactional(async (em) => {
  const author = await em.findOne(Author, 1);
  author.name = 'Updated Name';
  // Flush is called automatically upon successful completion
});
```

---

## 7. Unit Testing MikroORM Services

Mock `EntityRepository` and `EntityManager` in unit tests:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { AuthorsService } from './authors.service.js';
import { Author } from './entities/author.entity.js';

describe('AuthorsService (MikroORM)', () => {
  it('should find author by ID', async () => {
    const mockRepo = {
      findOneOrFail: vi.fn().mockResolvedValue({ id: 1, name: 'Alice' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthorsService,
        { provide: getRepositoryToken(Author), useValue: mockRepo },
        { provide: EntityManager, useValue: { persist: vi.fn(), flush: vi.fn() } },
      ],
    }).compile();

    const service = module.get<AuthorsService>(AuthorsService);
    const author = await service.authorRepo.findOneOrFail({ id: 1 });
    expect(author.name).toBe('Alice');
  });
});
```

# NestJS Data Persistence & Caching Reference

> **Source Reference**: [NestJS Official Documentation - Data](https://docs.nestjs.com/data/overview)

Modern enterprise backends require durable, high-performance data persistence and caching layers. NestJS is fundamentally **database-agnostic**: it can interface with any SQL or NoSQL database via raw drivers, query builders, or mature Object-Relational Mappers (ORMs).

This directory provides deep architectural reference and production guides for all official database integrations and caching solutions supported by NestJS.

---

## Data Tier Table of Contents

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Data Overview](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/01-overview.md) | Database agnosticism, architectural paradigms (Data Mapper, Repository, Query Builder), picking the right engine |
| **02** | [TypeORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/02-typeorm.md) | `@nestjs/typeorm`, repository pattern, entities, relations, `autoLoadEntities`, `QueryRunner` transactions, subscribers, testing |
| **03** | [Drizzle ORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/03-drizzle.md) | `@nestjs/drizzle`, Drizzle v1, schema inference (`$inferSelect`), relational queries (`defineRelations`), read replicas, Drizzle Kit |
| **04** | [Prisma](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/04-prisma.md) | Prisma Client, `PrismaService`, connection lifecycle hooks, `$transaction`, client extensions, mocking in Vitest |
| **05** | [MongoDB & Mongoose](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/05-mongodb.md) | `@nestjs/mongoose`, `@Schema()`, `@Prop()`, subdocuments, hooks, replica set transactions, `@InjectModel()` |
| **06** | [MikroORM](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/06-mikroorm.md) | `@mikro-orm/nestjs`, Unit of Work, Identity Map, request-scoped context forking, migrations |
| **07** | [Sequelize](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/07-sequelize.md) | `@nestjs/sequelize`, `sequelize-typescript`, model decorators, associations, managed transactions |
| **08** | [Caching](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/data/08-caching.md) | `@nestjs/cache-manager`, Keyv architecture, in-memory & Redis stores (`@keyv/redis`), `CacheInterceptor`, `@CacheKey()`, `@CacheTTL()` |

---

## Architectural Comparison Matrix

| Technology | Paradigm | Type Safety Model | Runtime Overhead | Best Suited For |
| :--- | :--- | :--- | :--- | :--- |
| **Drizzle** | Query Builder / Light ORM | Zero-overhead schema inference (`$inferSelect`) | Extremely low | Modern TypeScript, serverless, microservices, maximum SQL control |
| **TypeORM** | Repository / Active Record | Decorator-based entity mapping | Moderate | Traditional enterprise SQL, complex relational graphs, rich decorators |
| **Prisma** | Generated Client | Schema DSL (`schema.prisma`) code generation | Moderate (engine process / WASM) | Rapid prototyping, strong typing, clean declarative schemas |
| **Mongoose** | Document ODM | Class decorators (`@Schema`, `@Prop`) | Moderate | Schema-less or semi-structured document storage in MongoDB |
| **MikroORM** | Data Mapper / Unit of Work | Entity decorators with Identity Map | Moderate | Complex domain models requiring automatic change tracking |
| **Cache-Manager** | Key-Value Cache | Keyv storage abstraction | Extremely low | Sub-millisecond response caching, rate limiting, session storage |

---

## Core Conventions for `@araz`

1. **Strict Connection Lifecycle**: Database clients must manage connections gracefully. Pools must automatically close during application shutdown (`app.close()` or Kubernetes `SIGTERM`).
2. **Never Synchronize in Production**: Development auto-sync features (e.g. `synchronize: true` in TypeORM) are strictly forbidden in production environments. Schema changes must execute through reproducible, version-controlled **migrations**.
3. **Transaction Isolation**: Multi-table state mutations must execute within explicit ACID transactions (`QueryRunner`, `db.transaction()`, or `$transaction`).
4. **Isolated Test Environments**: Database repositories must be mockable using `getRepositoryToken()` or `getDrizzleToken()` custom providers to keep unit tests fast and independent of live databases.

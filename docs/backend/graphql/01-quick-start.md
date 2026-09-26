# 01 - GraphQL Quick Start

> **Source Reference**: [NestJS Official Documentation - Quick Start](https://docs.nestjs.com/graphql/quick-start)

GraphQL is an open-source query language for APIs and a runtime for fulfilling queries with existing application data. Unlike traditional REST endpoints where data structures are dictated by the server, GraphQL allows clients to request exact sub-graphs of information, enabling end-to-end type safety when paired with TypeScript.

`@nestjs/graphql` provides seamless integration with the GraphQL ecosystem, offering official drivers for **Apollo Server v5** (`@nestjs/apollo`) and **Mercurius** (`@nestjs/mercurius` on Fastify).

---

## 1. Installation

Install `@nestjs/graphql` alongside the chosen driver and peer dependencies:

```bash
# For Express and Apollo Server v5 (Default)
$ pnpm add @nestjs/graphql @nestjs/apollo @apollo/server @as-integrations/express5 graphql

# For Fastify and Apollo Server v5
# pnpm add @nestjs/graphql @nestjs/apollo @apollo/server @as-integrations/fastify graphql

# For Fastify and Mercurius (High Throughput)
# pnpm add @nestjs/graphql @nestjs/mercurius mercurius graphql
```

> [!WARNING]
> `@nestjs/apollo` v14+ requires **Apollo Server v5** (`@apollo/server`). Older packages like `apollo-server-express` are incompatible and deprecated.

---

## 2. Paradigms: Code First vs. Schema First

NestJS supports two architectural approaches to building GraphQL APIs:

1. **Code First (Recommended)**: You define TypeScript classes annotated with decorators (`@ObjectType()`, `@Field()`). NestJS introspects these classes at compile/boot time and automatically generates the executable GraphQL schema (in-memory or written to a `.gql` file).
2. **Schema First**: You manually author raw GraphQL SDL files (`.graphql`). NestJS parses these files at startup and optionally generates TypeScript interfaces or classes via `GraphQLDefinitionsFactory`.

---

## 3. Basic Apollo Configuration

Import `GraphQLModule` and configure it using the `forRoot()` method:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'node:path';
import { AuthorsModule } from './authors/authors.module.js';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code first: emit schema file to disk or set to true for in-memory generation
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      // Sort schema types lexicographically
      sortSchema: true,
      // Disable GraphiQL in production
      graphiql: process.env.NODE_ENV !== 'production',
    }),
    AuthorsModule,
  ],
})
export class AppModule {}
```

---

## 4. Accessing Request & Response Context

By default, GraphQL execution does not expose the underlying HTTP request and response objects to resolvers. You can provide an execution context factory via the `context` option:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  context: ({ req, res }) => ({ req, res }),
}),
```

Resolvers can then access the request object directly using the `@Context()` decorator:

```typescript
import { Context, Query, Resolver } from '@nestjs/graphql';
import type { Request } from 'express';

@Resolver()
export class UserAgentResolver {
  @Query(() => String)
  userAgent(@Context('req') req: Request): string {
    return req.headers['user-agent'] ?? 'unknown';
  }
}
```

> [!TIP]
> Guards, interceptors, and exception filters access this same context via `GqlExecutionContext.create(context).getContext()`.

---

## 5. In-Browser GraphQL IDE (GraphiQL)

In `@nestjs/graphql` v14+, **GraphiQL** is the official built-in IDE (the legacy `graphql-playground` has been completely removed).

- **Default Behavior**: Enabled automatically when `NODE_ENV !== 'production'`.
- **Explicit Toggle**: Use `graphiql: true` (force enable) or `graphiql: false` (disable entirely).

### Configuring GraphiQL

To configure development headers and IDE preferences, pass an options object:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  graphiql: {
    url: '/graphql',
    headers: {
      authorization: 'Bearer dev-token',
    },
    shouldPersistHeaders: true,
    isHeadersEditorEnabled: true,
    inputValueDeprecation: false,
  },
}),
```

### Apollo Sandbox Integration

To use Apollo Sandbox instead of GraphiQL:

```typescript
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      graphiql: false,
      plugins: [ApolloServerPluginLandingPageLocalDefault()],
    }),
  ],
})
export class AppModule {}
```

---

## 6. Accessing the Generated Schema Object

During integration or unit testing, you may need direct programmatic access to the compiled `GraphQLSchema` instance to run in-memory queries without spinning up an HTTP server. Use `GraphQLSchemaHost`:

```typescript
import { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { graphql } from 'graphql';

async function executeTestQuery(app: INestApplication, query: string) {
  const { schema } = app.get(GraphQLSchemaHost);
  return graphql({
    schema,
    source: query,
  });
}
```

---

## 7. Asynchronous Configuration

When driver settings depend on external configuration or asynchronous providers, use `forRootAsync()`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        autoSchemaFile: config.get<string>('GRAPHQL_SCHEMA_PATH', true),
        graphiql: config.get<boolean>('GRAPHQL_IDE_ENABLED', false),
        subscriptions: {
          'graphql-ws': true,
        },
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 8. Multiple Endpoints & Scoping

An enterprise application can serve multiple distinct GraphQL schemas on separate endpoints (e.g. `/customer-api` and `/internal-api`):

```typescript
@Module({
  imports: [
    // Endpoint 1: Public Customer Graph
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: '/customer-api',
      autoSchemaFile: 'customer-schema.gql',
      include: [CustomerModule],
    }),

    // Endpoint 2: Internal Admin Graph
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: '/admin-api',
      autoSchemaFile: 'admin-schema.gql',
      include: [AdminModule],
    }),
  ],
})
export class AppModule {}
```

### Scoping Types with `registerIn`

In the code-first approach, `include` specifies which resolvers to scan. To prevent types declared outside the included module from leaking into the schema, use the `registerIn` option:

```typescript
import { Field, ObjectType } from '@nestjs/graphql';
import { AdminModule } from './admin.module.js';

@ObjectType({ registerIn: () => AdminModule })
export class AuditLog {
  @Field()
  action: string;
}
```

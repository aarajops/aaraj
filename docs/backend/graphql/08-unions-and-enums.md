# 08 - GraphQL Unions and Enums

> **Source Reference**: [NestJS Official Documentation - Unions and Enums](https://docs.nestjs.com/graphql/unions-and-enums)

Union types and Enumeration types extend the GraphQL type system to handle polymorphic search results and restricted sets of discrete values.

---

## 1. Union Types

A **Union Type** represents an object that could be one of several discrete object types, without requiring those types to share common fields (unlike interfaces):

```typescript
import { createUnionType, Field, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Author {
  @Field()
  name: string;
}

@ObjectType()
export class Book {
  @Field()
  title: string;
}

// Register the union type
export const SearchResultUnion = createUnionType({
  name: 'SearchResultUnion',
  types: () => [Author, Book] as const,
  resolveType(value: any) {
    if (value.name) return Author;
    if (value.title) return Book;
    return null;
  },
});
```

> [!IMPORTANT]
> Always add a const assertion (`as const`) to the array returned by `types: () => [Author, Book] as const`. Without it, TypeScript fails to emit accurate declaration files.

Use the union type in query return signatures:

```typescript
@Resolver()
export class SearchResolver {
  @Query(() => [SearchResultUnion])
  search(): Array<typeof SearchResultUnion> {
    return [
      Object.assign(new Author(), { name: 'Isaac Asimov' }),
      Object.assign(new Book(), { title: 'Foundation' }),
    ];
  }
}
```

This emits the following GraphQL schema:

```graphql
union SearchResultUnion = Author | Book

type Query {
  search: [SearchResultUnion!]!
}
```

---

## 2. Enumeration Types (Enums)

Enums restrict field inputs and outputs to a validated, finite list of string values:

```typescript
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Register enum metadata with the GraphQL schema
registerEnumType(OrderStatus, {
  name: 'OrderStatus',
  description: 'Lifecycle state of an order',
  valuesMap: {
    PENDING: { description: 'Initial state before payment' },
    CANCELLED: { deprecationReason: 'Use REFUNDED in v2 schema' },
  },
});

@ObjectType()
export class Order {
  @Field(() => OrderStatus)
  status: OrderStatus;
}
```

This generates:

```graphql
"""Lifecycle state of an order"""
enum OrderStatus {
  """Initial state before payment"""
  PENDING
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED @deprecated(reason: "Use REFUNDED in v2 schema")
}
```

---

## 3. Schema First Internal Value Mapping

In schema-first architectures, public enum names in GraphQL can be mapped to different internal values (e.g. database integers or lower-case keys):

```graphql
enum Color {
  RED
  GREEN
}
```

Provide the mapping resolver to `GraphQLModule`:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  typePaths: ['./**/*.graphql'],
  resolvers: {
    Color: {
      RED: '#ff0000',
      GREEN: '#00ff00',
    },
  },
}),
```

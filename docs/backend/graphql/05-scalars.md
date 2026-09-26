# 05 - GraphQL Custom Scalars

> **Source Reference**: [NestJS Official Documentation - Scalars](https://docs.nestjs.com/graphql/scalars)

GraphQL object types represent complex, hierarchical domain entities, but their leaves must eventually resolve to atomic data primitives. These leaf values are called **scalars**.

GraphQL provides five built-in scalar types: `Int`, `Float`, `String`, `Boolean`, and `ID`. In real-world enterprise applications, domain requirements necessitate custom atomic primitives—such as ISO date-times, timestamps, UUIDs, or arbitrary JSON payloads.

---

## 1. Code First Default Scalar Modes

In the code-first approach, `@nestjs/graphql` ships with built-in mappings:
- **`Date`**: Mapped by default to `GraphQLISODateTime` (e.g. `2026-09-26T16:00:00.000Z`).
- **`number`**: Mapped by default to `GraphQLFloat`.

You can configure global scalar modes via `buildSchemaOptions`:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  buildSchemaOptions: {
    // Switch Date representation to epoch milliseconds (GraphQLTimestamp)
    dateScalarMode: 'timestamp',
    // Switch default number representation to integer
    numberScalarMode: 'integer',
  },
}),
```

---

## 2. Implementing Custom Scalars (`CustomScalar`)

To define a custom scalar, create a provider class decorated with `@Scalar()` that implements the `CustomScalar<TSerialized, TInternal>` interface:

```typescript
import { CustomScalar, Scalar } from '@nestjs/graphql';
import { Kind, type ValueNode } from 'graphql';

@Scalar('Date', () => Date)
export class DateScalar implements CustomScalar<number, Date> {
  description = 'Date custom scalar: serializes to Unix epoch ms, parses from ISO strings or numbers';

  // Value sent to the client in JSON responses
  serialize(value: unknown): number {
    return (value as Date).getTime();
  }

  // Value received from client variables
  parseValue(value: unknown): Date {
    return new Date(value as number | string);
  }

  // Value parsed from hard-coded inline AST literal in the GraphQL query string
  parseLiteral(ast: ValueNode): Date | null {
    if (ast.kind === Kind.INT) {
      return new Date(parseInt(ast.value, 10));
    }
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    return null;
  }
}
```

Register `DateScalar` as a provider in your module:

```typescript
import { Module } from '@nestjs/common';
import { DateScalar } from './date.scalar.js';

@Module({
  providers: [DateScalar],
  exports: [DateScalar],
})
export class CommonModule {}
```

Use the type in your object models:

```typescript
@ObjectType()
export class Order {
  @Field()
  createdAt: Date;
}
```

---

## 3. Importing External Scalars (`graphql-type-json`)

To support arbitrary JSON structures without static field typing, install `graphql-type-json`:

```bash
$ pnpm add graphql-type-json
```

Register it in the `resolvers` option of `GraphQLModule`:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import GraphQLJSON from 'graphql-type-json';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      resolvers: { JSON: GraphQLJSON },
    }),
  ],
})
export class AppModule {}
```

Use `GraphQLJSON` in `@Field()` decorators:

```typescript
import { Field, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@ObjectType()
export class AuditEvent {
  @Field(() => String)
  eventType: string;

  @Field(() => GraphQLJSON, { description: 'Dynamic event payload' })
  metadata: Record<string, unknown>;
}
```

---

## 4. Declaring Native `GraphQLScalarType` Instances

Alternatively, define custom scalars using the native `graphql` package's `GraphQLScalarType`:

```typescript
import { GraphQLScalarType, Kind } from 'graphql';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(value: unknown): string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new TypeError(`Invalid UUID format: "${value}"`);
  }
  return value;
}

export const UuidScalar = new GraphQLScalarType({
  name: 'UUID',
  description: 'RFC 4122 compliant Universal Unique Identifier',
  serialize: validateUUID,
  parseValue: validateUUID,
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? validateUUID(ast.value) : null),
});
```

Register `UuidScalar` in `GraphQLModule.forRoot({ resolvers: { UUID: UuidScalar } })` and reference it with `@Field(() => UuidScalar)`.

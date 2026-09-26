# 09 - GraphQL Field Middleware

> **Source Reference**: [NestJS Official Documentation - Field Middleware](https://docs.nestjs.com/graphql/field-middleware)

> [!NOTE]
> Field middleware is an exclusive capability of the **Code First** approach.

Field middleware lets you execute code **before or after** any individual field is resolved. Typical use cases include transforming or formatting field values, validating arguments, and enforcing field-level permissions.

---

## 1. Creating Field Middleware

A field middleware function implements the `FieldMiddleware` interface:

```typescript
import type { FieldMiddleware, MiddlewareContext, NextFn } from '@nestjs/graphql';

export const loggerMiddleware: FieldMiddleware = async (
  ctx: MiddlewareContext,
  next: NextFn,
) => {
  const { info } = ctx;
  const start = performance.now();

  // Execute the underlying field resolver
  const value = await next();

  const duration = (performance.now() - start).toFixed(2);
  console.log(`[Field ${info.parentType.name}.${info.fieldName}] Resolved in ${duration}ms`);

  return value;
};
```

- **`MiddlewareContext`**: Provides access to `{ source, args, context, info }`.
- **`next()`**: Executes the next middleware in the chain or the underlying resolver.
- **Return Value**: The value returned by the middleware replaces the field's resolved value.

> [!WARNING]
> Field middleware functions cannot inject dependencies or access the NestJS IoC container. To access external services or user sessions, attach data to the `context` object inside an HTTP guard or interceptor at the query level.

---

## 2. Transforming Field Values

Middleware can dynamically modify or mask resolved field values:

```typescript
import type { FieldMiddleware, MiddlewareContext, NextFn } from '@nestjs/graphql';

export const upperCaseMiddleware: FieldMiddleware = async (
  ctx: MiddlewareContext,
  next: NextFn,
) => {
  const value = await next();
  return typeof value === 'string' ? value.toUpperCase() : value;
};
```

---

## 3. Binding Middleware

### Local Binding to Specific Fields

Attach middleware directly to an `@Field()` or `@ResolveField()`:

```typescript
import { Field, ObjectType, ResolveField, Resolver } from '@nestjs/graphql';
import { loggerMiddleware, upperCaseMiddleware } from './field.middleware.js';

@ObjectType()
export class Recipe {
  @Field({ middleware: [loggerMiddleware, upperCaseMiddleware] })
  title: string;
}

@Resolver(() => Recipe)
export class RecipesResolver {
  @ResolveField(() => String, { middleware: [loggerMiddleware] })
  summary() {
    return 'Detailed recipe steps...';
  }
}
```

- **Chaining Order**: Functions run in the order declared in the array. The first function runs first and finishes last (onion-style).

### Global Field Middleware

To apply middleware to **every field** across the entire schema:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  buildSchemaOptions: {
    fieldMiddleware: [loggerMiddleware],
  },
}),
```

Global field middleware functions execute **before** locally bound field middleware.

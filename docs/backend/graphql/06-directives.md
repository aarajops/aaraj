# 06 - GraphQL Directives

> **Source Reference**: [NestJS Official Documentation - Directives](https://docs.nestjs.com/graphql/directives)

A directive can be attached to a field, object type, query, or fragment to alter schema validation, execution, or payload resolution. The GraphQL specification defines default directives such as `@deprecated`, `@skip`, and `@include`. Custom directives enable cross-cutting concerns—such as text transformation, role checks, or field masking—to be declared directly on schema definitions.

---

## 1. Custom Directive Transformers

To implement custom directive execution logic, define a schema transformer using `mapSchema` and `getDirective` from `@graphql-tools/utils`:

```bash
$ pnpm add @graphql-tools/utils
```

```typescript
import { getDirective, MapperKind, mapSchema } from '@graphql-tools/utils';
import { defaultFieldResolver, type GraphQLSchema } from 'graphql';

export function upperDirectiveTransformer(schema: GraphQLSchema, directiveName: string) {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const directive = getDirective(schema, fieldConfig, directiveName)?.[0];

      if (directive) {
        const { resolve = defaultFieldResolver } = fieldConfig;

        // Wrap the original resolver to uppercase string results
        fieldConfig.resolve = async function (source, args, context, info) {
          const result = await resolve(source, args, context, info);
          if (typeof result === 'string') {
            return result.toUpperCase();
          }
          return result;
        };

        return fieldConfig;
      }
    },
  });
}
```

---

## 2. Code First Application

### Applying the Directive

Annotate target fields or queries using `@Directive()`:

```typescript
import { Directive, Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Post {
  @Directive('@upper')
  @Field()
  title: string;

  @Directive('@deprecated(reason: "Use modern formattedContent instead")')
  @Field()
  summary: string;
}
```

### Registering the Transformer & AST Definition

In the code-first approach, directives must also be declared in the schema's AST via `buildSchemaOptions.directives`:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { DirectiveLocation, GraphQLDirective } from 'graphql';
import { upperDirectiveTransformer } from './directives/upper.directive.js';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      transformSchema: (schema) => upperDirectiveTransformer(schema, 'upper'),
      buildSchemaOptions: {
        directives: [
          new GraphQLDirective({
            name: 'upper',
            locations: [DirectiveLocation.FIELD_DEFINITION],
          }),
        ],
      },
    }),
  ],
})
export class AppModule {}
```

---

## 3. Schema First Directives

In the schema-first approach, declare the directive and apply it directly within your SDL:

```graphql
directive @upper on FIELD_DEFINITION

type Post {
  id: Int!
  title: String! @upper
}
```

Register the schema transformer in `GraphQLModule`:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  typePaths: ['./**/*.graphql'],
  transformSchema: (schema) => upperDirectiveTransformer(schema, 'upper'),
}),
```

# 12 - GraphQL Query Complexity

> **Source Reference**: [NestJS Official Documentation - Complexity](https://docs.nestjs.com/graphql/complexity)

> [!NOTE]
> Query complexity analysis is an exclusive feature of the **Code First** approach.

Because GraphQL clients have the power to define query shapes, malicious or unoptimized clients can construct deeply nested, recursive queries (e.g. `author { posts { author { posts { ... } } } }`) that exhaust database connection pools and CPU threads, causing Denial of Service (DoS).

Query complexity analysis assigns cost scores to individual fields, calculating the total cost before execution and rejecting operations that exceed a configured maximum complexity threshold.

---

## 1. Installation

Install `graphql-query-complexity`:

```bash
$ pnpm add graphql-query-complexity
```

---

## 2. Implementing the Complexity Plugin

Create an Apollo plugin that calculates query cost during the `didResolveOperation` phase:

```typescript
import { Plugin } from '@nestjs/apollo';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import type {
  ApolloServerPlugin,
  BaseContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { GraphQLError } from 'graphql';
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from 'graphql-query-complexity';

@Plugin()
export class ComplexityPlugin implements ApolloServerPlugin {
  constructor(private readonly gqlSchemaHost: GraphQLSchemaHost) {}

  async requestDidStart(): Promise<GraphQLRequestListener<BaseContext>> {
    const maxComplexity = 100;
    const { schema } = this.gqlSchemaHost;

    return {
      async didResolveOperation({ request, document }) {
        const complexity = getComplexity({
          schema,
          operationName: request.operationName,
          query: document,
          variables: request.variables,
          estimators: [
            // 1. Read custom complexity from field extensions
            fieldExtensionsEstimator(),
            // 2. Fall back to default complexity of 1 for standard fields
            simpleEstimator({ defaultComplexity: 1 }),
          ],
        });

        if (complexity > maxComplexity) {
          throw new GraphQLError(
            `Query rejected: complexity of ${complexity} exceeds the maximum allowed budget of ${maxComplexity}`,
            {
              extensions: {
                code: 'QUERY_TOO_COMPLEX',
                complexity,
                maxComplexity,
              },
            },
          );
        }

        console.log(`[Complexity Analysis] Score: ${complexity}/${maxComplexity}`);
      },
    };
  }
}
```

Register `ComplexityPlugin` as a provider in `AppModule`.

---

## 3. Configuring Field-Level Complexity

You can assign static or dynamic complexity scores to specific fields:

```typescript
import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Author {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  // Assign heavy score to expensive relational joins
  @Field(() => [Post], { complexity: 5 })
  posts: Post[];
}
```

---

## 4. Query-Level Dynamic Calculation

For queries accepting pagination parameters (`limit`, `count`), multiply the cost by the requested batch size:

```typescript
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import type { ComplexityEstimatorArgs } from 'graphql-query-complexity';
import { Post } from './models/post.model.js';
import { PostsService } from './posts.service.js';

@Resolver(() => Post)
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

  @Query(() => [Post], {
    // Multiplies the number of requested items by the complexity of child fields
    complexity: (options: ComplexityEstimatorArgs) =>
      options.args.count * options.childComplexity,
  })
  async posts(@Args('count', { type: () => Int, defaultValue: 10 }) count: number) {
    return this.postsService.findAll({ limit: count });
  }
}
```

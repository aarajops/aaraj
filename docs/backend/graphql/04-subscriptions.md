# 04 - GraphQL Subscriptions

> **Source Reference**: [NestJS Official Documentation - Subscriptions](https://docs.nestjs.com/graphql/subscriptions)

Subscriptions provide real-time, event-driven data pushing from the server to connected clients over persistent WebSockets. Instead of executing a single request/response cycle, a subscription establishes a continuous stream that delivers newly published payloads whenever specific events occur.

---

## 1. Enabling Subscriptions (Apollo Driver & `graphql-ws`)

In `@nestjs/graphql` v14+, subscriptions are transported exclusively using the [graphql-ws](https://github.com/enisdenjo/graphql-ws) protocol:

```bash
$ pnpm add graphql-ws
```

Enable the transport in `GraphQLModule`:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      subscriptions: {
        'graphql-ws': true,
      },
    }),
  ],
})
export class AppModule {}
```

> [!WARNING]
> Support for the legacy `subscriptions-transport-ws` library has been **completely removed**. The `'subscriptions-transport-ws'` option is no longer accepted, and legacy clients will fail to connect.

---

## 2. Setting Up a Shared PubSub Provider

The default in-memory `PubSub` class from `graphql-subscriptions` is suitable for local development. In production, provide a Redis-backed engine (e.g. `graphql-redis-subscriptions`):

```typescript
import { Global, Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

export const PUB_SUB = 'PUB_SUB';

@Global()
@Module({
  providers: [
    {
      provide: PUB_SUB,
      useValue: new PubSub(),
    },
  ],
  exports: [PUB_SUB],
})
export class PubSubModule {}
```

---

## 3. Creating & Publishing Subscriptions

### Defining the Subscription Handler

Use the `@Subscription()` decorator and return an `AsyncIterableIterator` from `PubSub`:

```typescript
import { Inject } from '@nestjs/common';
import { Resolver, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';
import { Comment } from './models/comment.model.js';
import { PUB_SUB } from '../common/pub-sub.module.js';

@Resolver(() => Comment)
export class CommentsResolver {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @Subscription(() => Comment, {
    description: 'Emitted when a new comment is posted',
  })
  commentAdded() {
    return this.pubSub.asyncIterableIterator('commentAdded');
  }
}
```

This generates the following schema entry:

```graphql
type Subscription {
  """Emitted when a new comment is posted"""
  commentAdded: Comment!
}
```

### Publishing Events from Mutations

Trigger real-time notifications by calling `pubSub.publish()`. The payload key must match the subscription property name:

```typescript
import { Inject } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';
import { Comment } from './models/comment.model.js';
import { CreateCommentInput } from './dto/create-comment.input.js';
import { CommentsService } from './comments.service.js';
import { PUB_SUB } from '../common/pub-sub.module.js';

@Resolver(() => Comment)
export class CommentsResolver {
  constructor(
    private readonly commentsService: CommentsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Comment)
  async addComment(
    @Args('input') input: CreateCommentInput,
  ): Promise<Comment> {
    const newComment = await this.commentsService.create(input);

    // Emits payload to all active subscribers
    await this.pubSub.publish('commentAdded', { commentAdded: newComment });

    return newComment;
  }
}
```

---

## 4. Filtering & Mutating Subscriptions

### Event Filtering

Filter outgoing notifications based on client-provided query variables:

```typescript
@Subscription(() => Comment, {
  filter: (payload, variables) => {
    // Only push if the comment belongs to the requested post ID
    return payload.commentAdded.postId === variables.postId;
  },
})
commentAddedForPost(@Args('postId') postId: string) {
  return this.pubSub.asyncIterableIterator('commentAdded');
}
```

### Transforming Payloads with `resolve`

If the published event format differs from the GraphQL output schema, use `resolve` to format the data:

```typescript
@Subscription(() => Comment, {
  resolve: (payload) => {
    // Return the unwrapped domain object directly
    return {
      ...payload.commentAdded,
      formattedDate: new Date(payload.commentAdded.createdAt).toISOString(),
    };
  },
})
commentAdded() {
  return this.pubSub.asyncIterableIterator('commentAdded');
}
```

---

## 5. WebSocket Authentication & Context Binding

To validate JWTs or API keys during the initial WebSocket handshake, configure `onConnect` inside the `graphql-ws` options:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { Context } from 'graphql-ws';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      subscriptions: {
        'graphql-ws': {
          onConnect: async (context: Context<Record<string, unknown>>) => {
            const { connectionParams, extra } = context;
            const token = connectionParams?.authToken as string;

            if (!token || !isValidToken(token)) {
              throw new Error('Unauthorized WebSocket connection');
            }

            // In graphql-ws, extra variables belong in the `extra` object
            (extra as any).user = decodeUser(token);
          },
        },
      },
      // Expose the authenticated user to resolver execution context
      context: ({ req, res, extra }) => {
        if (extra?.user) {
          return { user: extra.user };
        }
        return { req, res };
      },
    }),
  ],
})
export class AppModule {}
```

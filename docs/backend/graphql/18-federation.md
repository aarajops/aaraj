# 18 - Apollo Federation & Supergraphs

> **Source Reference**: [NestJS Official Documentation - Federation](https://docs.nestjs.com/graphql/federation)

**Apollo Federation** allows you to split a monolithic GraphQL schema across independent, distributed microservices (called **subgraphs**). A unified gateway or router (such as Apollo Gateway or Apollo Router) composes these subgraphs into a single, cohesive **Supergraph** that client applications query.

---

## 1. Federation 2 Architecture

In **Federation 2**, subgraphs share and extend types cleanly without the legacy `@extends` and `@external` directives of Federation 1.

```text
                                CLIENT APPLICATION
                                        │
                                        ▼
                           ┌─────────────────────────┐
                           │      Apollo Gateway     │
                           │  (Supergraph Router)    │
                           └────────────┬────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
       ┌─────────────────────────┐             ┌─────────────────────────┐
       │   Users Subgraph (API)  │             │   Posts Subgraph (API)  │
       │   • User Entity (@key)  │             │   • Post Entity (@key)  │
       │   • resolveReference()  │             │   • user.posts field    │
       └─────────────────────────┘             └─────────────────────────┘
```

---

## 2. Setting Up an Entity Subgraph (Users Service)

Install `@apollo/subgraph`:

```bash
$ pnpm add @apollo/subgraph
```

### The Subgraph Entity

Mark the entity with the `@key` directive to designate its primary lookup field:

```typescript
import { Directive, Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
@Directive('@key(fields: "id")')
export class User {
  @Field(() => ID)
  id: number;

  @Field()
  name: string;
}
```

### Resolving Entity References (`@ResolveReference`)

When another subgraph requests user information, the Apollo Gateway invokes the `@ResolveReference()` handler:

```typescript
import { Args, Query, Resolver, ResolveReference } from '@nestjs/graphql';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Resolver(() => User)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => User)
  getUser(@Args('id') id: number): User {
    return this.usersService.findById(id);
  }

  // Gateway calls this method to satisfy cross-service references
  @ResolveReference()
  resolveReference(reference: { __typename: string; id: number }): User {
    return this.usersService.findById(reference.id);
  }
}
```

### Subgraph Module Configuration

Configure `GraphQLModule` with `ApolloFederationDriver` and enable Federation 2:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloFederationDriver, type ApolloFederationDriverConfig } from '@nestjs/apollo';
import { UsersResolver } from './users.resolver.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloFederationDriverConfig>({
      driver: ApolloFederationDriver,
      autoSchemaFile: {
        federation: 2, // Enable Apollo Federation 2
      },
    }),
  ],
  providers: [UsersResolver, UsersService],
})
export class AppModule {}
```

---

## 3. Extending Entities in Another Subgraph (Posts Service)

The `Posts` subgraph owns the `Post` entity, but also extends the `User` entity by adding a `posts` field:

### The Extended User Type

```typescript
import { Directive, Field, ID, ObjectType } from '@nestjs/graphql';
import { Post } from './post.entity.js';

@ObjectType()
@Directive('@key(fields: "id")')
export class User {
  @Field(() => ID)
  id: number;

  @Field(() => [Post])
  posts?: Post[];
}
```

### Resolving the Extension Field

```typescript
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { User } from './user.entity.js';
import { Post } from './post.entity.js';
import { PostsService } from './posts.service.js';

@Resolver(() => User)
export class UsersResolver {
  constructor(private readonly postsService: PostsService) {}

  @ResolveField(() => [Post])
  posts(@Parent() user: User): Post[] {
    return this.postsService.findByAuthorId(user.id);
  }
}
```

### Returning Parent References from Posts

```typescript
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Post } from './post.entity.js';
import { User } from './user.entity.js';

@Resolver(() => Post)
export class PostsResolver {
  @ResolveField(() => User)
  user(@Parent() post: Post): any {
    // Return entity reference representation for the gateway to route
    return { __typename: 'User', id: post.authorId };
  }
}
```

### Subgraph Registration with `orphanedTypes`

Because `User` is not returned directly by a root query in the Posts service, specify it in `orphanedTypes`:

```typescript
GraphQLModule.forRoot<ApolloFederationDriverConfig>({
  driver: ApolloFederationDriver,
  autoSchemaFile: {
    federation: 2,
  },
  buildSchemaOptions: {
    orphanedTypes: [User],
  },
}),
```

---

## 4. Apollo Gateway (Supergraph Router)

The gateway is an independent service that introspects and unifies all subgraphs:

```bash
$ pnpm add @apollo/gateway
```

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloGatewayDriver, type ApolloGatewayDriverConfig } from '@nestjs/apollo';
import { IntrospectAndCompose } from '@apollo/gateway';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloGatewayDriverConfig>({
      driver: ApolloGatewayDriver,
      gateway: {
        supergraphSdl: new IntrospectAndCompose({
          subgraphs: [
            { name: 'users', url: 'http://users-service:3000/graphql' },
            { name: 'posts', url: 'http://posts-service:3000/graphql' },
          ],
        }),
      },
    }),
  ],
})
export class GatewayModule {}
```

# 03 - GraphQL Mutations

> **Source Reference**: [NestJS Official Documentation - Mutations](https://docs.nestjs.com/graphql/mutations)

While queries represent read-only operations that should not introduce side effects, **mutations** are the canonical convention in GraphQL for writing, updating, or deleting server-side state.

---

## 1. Code First Mutations

In the code-first approach, mutations are declared using the `@Mutation()` decorator on resolver methods:

```typescript
import { Args, Int, Mutation, Resolver } from '@nestjs/graphql';
import { Post } from './models/post.model.js';
import { PostsService } from './posts.service.js';

@Resolver(() => Post)
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

  @Mutation(() => Post, { description: 'Increment votes on a post' })
  async upvotePost(@Args('postId', { type: () => Int }) postId: number): Promise<Post> {
    return this.postsService.upvoteById(postId);
  }
}
```

This generates the following SDL definition:

```graphql
type Mutation {
  """Increment votes on a post"""
  upvotePost(postId: Int!): Post!
}
```

---

## 2. Input Types (`@InputType`)

When a mutation accepts an object rather than scalar parameters, define an **Input Type** using `@InputType()`. In the GraphQL specification, input types are strictly separated from output object types (`@ObjectType()`):

```typescript
import { Field, InputType, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsPositive, MinLength } from 'class-validator';

@InputType({ description: 'Data required to create a new post' })
export class CreatePostInput {
  @Field({ description: 'The title of the post' })
  @MinLength(5)
  title: string;

  @Field(() => Int, { description: 'Author ID of the creator' })
  @IsPositive()
  authorId: number;

  @Field({ nullable: true })
  content?: string;
}
```

Pass the input type to the `@Mutation()` handler via `@Args()`:

```typescript
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Post } from './models/post.model.js';
import { CreatePostInput } from './dto/create-post.input.js';
import { PostsService } from './posts.service.js';

@Resolver(() => Post)
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

  @Mutation(() => Post)
  async createPost(
    @Args('createPostInput') createPostInput: CreatePostInput,
  ): Promise<Post> {
    return this.postsService.create(createPostInput);
  }
}
```

This emits the following GraphQL schema:

```graphql
input CreatePostInput {
  """The title of the post"""
  title: String!
  """Author ID of the creator"""
  authorId: Int!
  content: String
}

type Mutation {
  createPost(createPostInput: CreatePostInput!): Post!
}
```

---

## 3. Nested Input Types

Input types can reference other input types to create rich, hierarchical payload structures:

```typescript
@InputType()
export class PostMetadataInput {
  @Field(() => [String])
  tags: string[];

  @Field({ defaultValue: false })
  isPublished: boolean;
}

@InputType()
export class CreatePostWithMetadataInput {
  @Field()
  title: string;

  @Field(() => PostMetadataInput)
  metadata: PostMetadataInput;
}
```

---

## 4. Schema First Mutations

In the schema-first paradigm, define the mutation and input types directly in your `.graphql` schema files:

```graphql
input UpvotePostInput {
  postId: Int!
}

type Mutation {
  upvotePost(input: UpvotePostInput!): Post!
}
```

Then annotate the resolver method without explicit return type functions:

```typescript
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { PostsService } from './posts.service.js';

@Resolver('Post')
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

  @Mutation()
  async upvotePost(@Args('input') input: { postId: number }) {
    return this.postsService.upvoteById(input.postId);
  }
}
```

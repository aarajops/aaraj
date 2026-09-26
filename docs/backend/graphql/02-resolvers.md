# 02 - GraphQL Resolvers

> **Source Reference**: [NestJS Official Documentation - Resolvers](https://docs.nestjs.com/graphql/resolvers)

Resolvers provide the instructions for transforming a GraphQL operation (a query, mutation, or subscription) into domain data. Instead of manually constructing complex resolver maps, `@nestjs/graphql` automatically builds the schema and runtime execution map from metadata provided by TypeScript class decorators.

---

## 1. Code First: Object Types

In the code-first approach, TypeScript classes serve as the single source of truth for both schema generation and runtime data shaping:

```typescript
import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'A blog post published by an author' })
export class Post {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field(() => Int, { nullable: true })
  votes?: number;
}

@ObjectType({ description: 'An author who writes articles' })
export class Author {
  @Field(() => Int)
  id: number;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  // Specify explicit array type
  @Field(() => [Post])
  posts: Post[];
}
```

### The `@Field()` Decorator Options

Because TypeScript's metadata reflection cannot distinguish between integers and floats, or detect whether a property is optional at runtime, explicit metadata is provided through `@Field()`:

- **Type Function**: Required for ambiguous types (e.g. `() => Int` vs `() => Float`) or arrays (`() => [Post]`).
- **`nullable`**:
  - `false` (default): Field cannot be null (`Post!`).
  - `true`: Field can be null (`Post`).
  - `'items'`: Array is required, but items can be null (`[Post]!`).
  - `'itemsAndList'`: Both array and its items can be null (`[Post]`).
- **`description`**: Adds markdown documentation visible in GraphiQL.
- **`deprecationReason`**: Marks a field as deprecated (`@deprecated(reason: "...")`).

---

## 2. Resolver Classes & Query Handlers

To expose queries, define a resolver class annotated with `@Resolver()`:

```typescript
import { Args, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Author, Post } from './models/author.model.js';
import { AuthorsService } from './authors.service.js';
import { PostsService } from './posts.service.js';

@Resolver(() => Author)
export class AuthorsResolver {
  constructor(
    private readonly authorsService: AuthorsService,
    private readonly postsService: PostsService,
  ) {}

  @Query(() => Author, { name: 'author', description: 'Find an author by ID' })
  async getAuthor(@Args('id', { type: () => Int }) id: number): Promise<Author> {
    return this.authorsService.findOneById(id);
  }

  // Field resolver: resolves the 'posts' relation on the Author parent
  @ResolveField(() => [Post])
  async posts(@Parent() author: Author): Promise<Post[]> {
    return this.postsService.findAllByAuthorId(author.id);
  }
}
```

- `@Resolver(() => Author)`: Identifies `Author` as the parent object type for all child `@ResolveField()` methods within the class.
- `@Parent()`: Injects the parent instance currently being traversed in the GraphQL execution tree.

---

## 3. Extracting Arguments (`@Args` & `@ArgsType`)

For simple queries, `@Args()` can be used inline:

```typescript
@Query(() => Author)
async author(
  @Args('id', { type: () => Int }) id: number,
  @Args('includeInactive', { type: () => Boolean, defaultValue: false }) includeInactive: boolean,
) {
  return this.authorsService.find(id, includeInactive);
}
```

### Dedicated Arguments Class (`@ArgsType`)

When an operation accepts multiple parameters, create an `@ArgsType()` class to keep handlers clean and enable standard validation pipes:

```typescript
import { ArgsType, Field, Int } from '@nestjs/graphql';
import { Min, MinLength } from 'class-validator';

@ArgsType()
export class GetAuthorArgs {
  @Field(() => Int)
  @Min(1)
  id: number;

  @Field({ nullable: true })
  @MinLength(2)
  searchPrefix?: string;
}
```

Use `@Args()` without parameters to inject the entire arguments instance:

```typescript
@Query(() => Author)
async author(@Args() args: GetAuthorArgs) {
  return this.authorsService.findWithFilter(args.id, args.searchPrefix);
}
```

---

## 4. Class Inheritance & Reusable Resolvers

You can inherit fields and arguments across class hierarchies:

```typescript
import { ArgsType, Field, Int } from '@nestjs/graphql';

@ArgsType()
export class PaginationArgs {
  @Field(() => Int, { defaultValue: 0 })
  offset: number;

  @Field(() => Int, { defaultValue: 20 })
  limit: number;
}

@ArgsType()
export class SearchAuthorsArgs extends PaginationArgs {
  @Field()
  term: string;
}
```

### Generic Base Resolvers

To avoid writing repetitive CRUD queries, create a factory that emits abstract generic resolvers:

```typescript
import { Type } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

export function BaseCrudResolver<T extends Type<unknown>>(classRef: T) {
  @Resolver({ isAbstract: true })
  abstract class BaseResolverHost {
    @Query(() => [classRef], { name: `findAll${classRef.name}` })
    async findAll(): Promise<T[]> {
      return [];
    }
  }

  return BaseResolverHost;
}

@Resolver(() => Post)
export class PostsResolver extends BaseCrudResolver(Post) {
  constructor(private readonly postsService: PostsService) {
    super();
  }
}
```

---

## 5. Cursor-Based Pagination via Generics

Implement Relay-specification cursor pagination using higher-order functions:

```typescript
import { Field, Int, ObjectType } from '@nestjs/graphql';
import type { Type } from '@nestjs/common';

export interface IEdgeType<T> {
  cursor: string;
  node: T;
}

export interface IPaginatedType<T> {
  edges: IEdgeType<T>[];
  totalCount: number;
  hasNextPage: boolean;
}

export function Paginated<T>(classRef: Type<T>): Type<IPaginatedType<T>> {
  @ObjectType(`${classRef.name}Edge`)
  abstract class EdgeType implements IEdgeType<T> {
    @Field(() => String)
    cursor: string;

    @Field(() => classRef)
    node: T;
  }

  @ObjectType({ isAbstract: true })
  abstract class PaginatedType implements IPaginatedType<T> {
    @Field(() => [EdgeType])
    edges: EdgeType[];

    @Field(() => Int)
    totalCount: number;

    @Field(() => Boolean)
    hasNextPage: boolean;
  }

  return PaginatedType as Type<IPaginatedType<T>>;
}

// Concrete Usage
@ObjectType()
export class PaginatedAuthor extends Paginated(Author) {}
```

---

## 6. Standard Resolver Parameter Decorators

NestJS maps standard GraphQL resolver arguments to dedicated parameter decorators:

| Decorator | Underlying GraphQL Parameter | Primary Purpose |
| :--- | :--- | :--- |
| `@Root()` / `@Parent()` | `parent` | The resolved object of the parent field. |
| `@Context(param?: string)` | `context` | Shared per-request state (e.g. user session, HTTP headers). |
| `@Info(param?: string)` | `info` | AST information detailing the fields selected by the client. |
| `@Args(param?: string)` | `args` | Parameters supplied to the query or field. |

# 17 - GraphQL Advanced Platform Features

> **Source Reference**: [NestJS Official Documentation - Other Features](https://docs.nestjs.com/graphql/other-features)

NestJS enables developers to apply standard cross-cutting features—**Guards**, **Interceptors**, **Pipes**, and **Exception Filters**—identically across both RESTful HTTP routes and GraphQL resolvers.

---

## 1. Execution Context Transformation

Because a GraphQL resolver receives `{ root, args, context, info }` instead of raw HTTP `(req, res, next)`, guards and interceptors must transform the generic `ExecutionContext` into a `GqlExecutionContext`:

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 1. Transform generic host into GraphQL-specific context
    const gqlContext = GqlExecutionContext.create(context);

    // 2. Extract shared request context
    const { req } = gqlContext.getContext();
    const user = req?.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required to access GraphQL operation');
    }

    return true;
  }
}
```

Apply the guard directly to query or mutation methods:

```typescript
@Query(() => Author)
@UseGuards(GqlAuthGuard)
async getAuthor(@Args('id', ParseIntPipe) id: number) {
  return this.authorsService.findOneById(id);
}
```

---

## 2. GraphQL Exception Filters

Standard NestJS exception filters can be applied to GraphQL operations by converting `ArgumentsHost` to `GqlArgumentsHost`:

```typescript
import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { GqlArgumentsHost, GqlExceptionFilter } from '@nestjs/graphql';

@Catch(HttpException)
export class GqlHttpExceptionFilter implements GqlExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host);

    // Return the exception directly; Apollo/Mercurius formats it into the errors array
    return exception;
  }
}
```

---

## 3. Custom Parameter Decorators

Create custom parameter decorators that extract data directly from the GraphQL context:

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const gqlCtx = GqlExecutionContext.create(ctx);
    const user = gqlCtx.getContext().req?.user;
    return data ? user?.[data] : user;
  },
);
```

Consume the decorator in any mutation or query:

```typescript
@Mutation(() => Post)
@UseGuards(GqlAuthGuard)
async createPost(
  @CurrentUser() user: UserEntity,
  @Args('input') input: CreatePostInput,
) {
  return this.postsService.createForUser(user.id, input);
}
```

---

## 4. Executing Enhancers at the Field Resolver Level

By default, NestJS executes guards, interceptors, and filters **only on top-level `@Query()` and `@Mutation()` operations**, skipping them for `@ResolveField()` methods to avoid severe performance degradation.

To enable enhancers on field resolvers, configure `fieldResolverEnhancers`:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  // Enable execution of interceptors on child field resolvers
  fieldResolverEnhancers: ['interceptors', 'guards'],
}),
```

> [!WARNING]
> If a query returns an array of 5,000 posts, an enhancer attached to `@ResolveField('author')` will execute 5,000 separate times! Use helper guards to skip unnecessary checks on child fields:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';

export function isResolvingChildField(context: ExecutionContext): boolean {
  if (context.getType<GqlContextType>() === 'graphql') {
    const info = GqlExecutionContext.create(context).getInfo();
    return info.parentType.name !== 'Query' && info.parentType.name !== 'Mutation';
  }
  return false;
}
```

---

## 5. Creating a Custom GraphQL Driver

To integrate alternative GraphQL engines (such as `graphql-http` or custom serverless adapters), extend `AbstractGraphQLDriver`:

```typescript
import { AbstractGraphQLDriver, type GqlModuleOptions } from '@nestjs/graphql';
import { createHandler } from 'graphql-http/lib/use/express';

export class ExpressGraphQLHttpDriver extends AbstractGraphQLDriver {
  async start(options: GqlModuleOptions<any>): Promise<void> {
    const { httpAdapter } = this.httpAdapterHost;
    // Bind headless handler to express instance
    httpAdapter.use('/graphql', createHandler({ schema: options.schema! }));
  }

  async stop(): Promise<void> {
    // Teardown connections if necessary
  }
}
```

Register the custom driver in `GraphQLModule`:

```typescript
GraphQLModule.forRoot({
  driver: ExpressGraphQLHttpDriver,
});
```

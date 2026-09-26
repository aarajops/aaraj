# 13 - GraphQL Extensions

> **Source Reference**: [NestJS Official Documentation - Extensions](https://docs.nestjs.com/graphql/extensions)

> [!NOTE]
> Extensions are an exclusive advanced feature of the **Code First** approach.

Extensions allow you to attach arbitrary metadata to GraphQL fields, input types, and object classes. This metadata is stored in the underlying GraphQL AST and can be introspected at runtime by field middleware, interceptors, or complexity estimators to implement fine-grained field-level authorization (RBAC) and auditing.

---

## 1. Attaching Custom Metadata (`@Extensions`)

Attach custom metadata to any field using the `@Extensions()` decorator:

```typescript
import { Extensions, Field, ObjectType } from '@nestjs/graphql';

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@ObjectType()
export class UserAccount {
  @Field()
  username: string;

  // Restrict access to administrators
  @Field()
  @Extensions({ role: Role.ADMIN })
  email: string;

  @Field()
  @Extensions({ role: Role.ADMIN })
  stripeCustomerId: string;
}
```

Metadata can also be attached at the class level (`@Extensions({ sensitive: true })`) or method level on query/mutation handlers.

---

## 2. Enforcing Field-Level Permissions with Middleware

Combine `@Extensions()` with field middleware to verify caller permissions before returning sensitive fields:

```typescript
import { ForbiddenException } from '@nestjs/common';
import type { FieldMiddleware, MiddlewareContext, NextFn } from '@nestjs/graphql';
import { Role } from './roles.enum.js';

export const checkRoleMiddleware: FieldMiddleware = async (
  ctx: MiddlewareContext,
  next: NextFn,
) => {
  const { info, context } = ctx;
  const fieldConfig = info.parentType.getFields()[info.fieldName];
  const requiredRole = fieldConfig.extensions?.role as Role | undefined;

  if (requiredRole) {
    // Current user context extracted from HTTP request
    const user = context.req?.user;

    if (!user || user.role !== requiredRole) {
      throw new ForbiddenException(
        `Insufficient permissions to access field "${info.parentType.name}.${info.fieldName}". Required: ${requiredRole}`,
      );
    }
  }

  return next();
};
```

Bind the middleware globally or locally to protect all marked fields:

```typescript
@ObjectType()
export class UserAccount {
  @Field({ middleware: [checkRoleMiddleware] })
  @Extensions({ role: Role.ADMIN })
  stripeCustomerId: string;
}
```

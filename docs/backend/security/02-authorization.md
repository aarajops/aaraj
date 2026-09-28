# 02 - Authorization

> **Source Reference**: [NestJS Official Documentation - Authorization](https://docs.nestjs.com/security/authorization)

**Authorization** determines what an authenticated identity is permitted to do. While authentication verifies *who* the user is, authorization evaluates *what permissions or capabilities* that identity holds when requesting a specific action on a resource.

NestJS supports multiple authorization paradigms:
1. **Role-Based Access Control (RBAC)**: Assigning static coarse-grained roles (`admin`, `editor`, `viewer`) to users.
2. **Claims- / Permission-Based Authorization**: Assigning granular functional capabilities (`users:write`, `reports:export`) to tokens.
3. **Attribute-Based Access Control (ABAC) with CASL**: Dynamic policy rules evaluated against resource attributes (e.g. *"Users can edit articles only if they are the author and the article is not yet published"*).

---

## 1. Role-Based Access Control (RBAC)

### Step 1: Define Role Enum & `@Roles()` Decorator

```typescript
// src/auth/roles/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export enum Role {
  Admin = 'admin',
  Manager = 'manager',
  User = 'user',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

### Step 2: Implement `RolesGuard`

The `RolesGuard` reads metadata using `Reflector` and verifies that the authenticated `request.user` contains at least one of the required roles:

```typescript
// src/auth/roles/roles.guard.ts
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, route is accessible to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.roles) {
      throw new ForbiddenException('User identity lacks role attributes');
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException('Insufficient privileges for this resource');
    }

    return true;
  }
}
```

### Step 3: Protecting Controller Routes

```typescript
// src/admin/admin.controller.ts
import { Controller, Post, Delete, UseGuards } from '@nestjs/common';
import { Roles, Role } from '../auth/roles/roles.decorator.js';
import { RolesGuard } from '../auth/roles/roles.guard.js';

@Controller('admin')
@UseGuards(RolesGuard) // Can also be bound globally via APP_GUARD
export class AdminController {
  @Post('users')
  @Roles(Role.Admin, Role.Manager)
  createUser() {
    return { status: 'User created' };
  }

  @Delete('system')
  @Roles(Role.Admin) // Only superadmins can delete system data
  purgeSystem() {
    return { status: 'Purged' };
  }
}
```

---

## 2. Claims- & Permission-Based Authorization

When applications require finer granularity than roles, assign individual permissions (`orders:create`, `orders:cancel`, `billing:read`):

```typescript
// src/auth/permissions/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

```typescript
// Usage in controller:
@Post('invoices')
@RequirePermissions('invoices:write')
createInvoice() {
  return this.invoiceService.create();
}
```

---

## 3. Dynamic Attribute-Based Authorization with CASL

For complex rules involving dynamic runtime state (e.g. comparing `article.authorId === user.id`), use [CASL](https://casl.js.org/).

### Installation

```bash
pnpm --filter @aaraj/api add @casl/ability
```

### Defining Actions & Subject Types

```typescript
// src/casl/casl-ability.factory.ts
import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
  type InferSubjects,
  type ExtractSubjectType,
} from '@casl/ability';
import { Injectable } from '@nestjs/common';

export enum Action {
  Manage = 'manage', // Special CASL keyword representing ANY action
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

export class Article {
  id!: string;
  authorId!: string;
  isPublished!: boolean;
}

export class User {
  id!: string;
  isAdmin!: boolean;
}

type Subjects = InferSubjects<typeof Article | typeof User> | 'all';
export type AppAbility = MongoAbility<[Action, Subjects]>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: User): AppAbility {
    const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

    if (user.isAdmin) {
      can(Action.Manage, 'all'); // Admins can manage everything
    } else {
      can(Action.Read, 'all');   // Regular users have read access
    }

    // Rule: Users can update articles ONLY if they are the author:
    can(Action.Update, Article, { authorId: user.id });

    // Rule: Published articles cannot be deleted by anyone except admins:
    cannot(Action.Delete, Article, { isPublished: true });

    return build({
      detectSubjectType: (item) =>
        item.constructor as ExtractSubjectType<Subjects>,
    });
  }
}
```

---

## 4. Policy Guards (`@CheckPolicies()`)

Build a reusable `PoliciesGuard` to enforce CASL rules declaratively:

```typescript
// src/casl/policy-handler.ts
import type { AppAbility } from './casl-ability.factory.js';

export interface IPolicyHandler {
  handle(ability: AppAbility): boolean;
}

type PolicyCallback = (ability: AppAbility) => boolean;
export type PolicyHandler = IPolicyHandler | PolicyCallback;
```

```typescript
// src/casl/check-policies.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { PolicyHandler } from './policy-handler.js';

export const CHECK_POLICIES_KEY = 'check_policies';
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
```

### Implementing `PoliciesGuard`

```typescript
// src/casl/policies.guard.ts
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaslAbilityFactory, type AppAbility } from './casl-ability.factory.js';
import { CHECK_POLICIES_KEY } from './check-policies.decorator.js';
import type { PolicyHandler } from './policy-handler.js';

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caslAbilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers =
      this.reflector.get<PolicyHandler[]>(
        CHECK_POLICIES_KEY,
        context.getHandler(),
      ) ?? [];

    if (handlers.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const ability = this.caslAbilityFactory.createForUser(user);

    const hasPermission = handlers.every((handler) =>
      typeof handler === 'function' ? handler(ability) : handler.handle(ability),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Action denied by authorization policy');
    }

    return true;
  }
}
```

### Controller Usage:

```typescript
@Get()
@UseGuards(PoliciesGuard)
@CheckPolicies((ability: AppAbility) => ability.can(Action.Read, Article))
findAllArticles() {
  return this.articlesService.findAll();
}
```

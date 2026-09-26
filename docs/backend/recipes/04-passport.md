# Passport Authentication

> **Domain**: Enterprise Identity, Token Verification & Strategy Chaining  
> **Source Reference**: [NestJS Passport Recipe](https://docs.nestjs.com/recipes/passport)  
> **Package**: `@nestjs/passport` | `passport` | `@nestjs/jwt`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

[Passport](https://github.com/jaredhanson/passport) is the standard authentication library for Node.js. The `@nestjs/passport` module wraps Passport strategies in NestJS dependency injection constructs, allowing you to orchestrate username/password verification, JWT bearer token validation, OAuth2 integrations, and session management.

---

## 1. Installation

Install `@nestjs/passport`, `passport`, and the strategy-specific implementations:

```bash
pnpm add @nestjs/passport passport passport-local @nestjs/jwt passport-jwt
pnpm add -D @types/passport-local @types/passport-jwt
```

---

## 2. Implementing Local Authentication (Username/Password)

### 1. Verification Strategy (`LocalStrategy`)

The strategy extends `PassportStrategy(Strategy)`. Its `validate()` method acts as Passport's verify callback:

```typescript
// apps/api/src/auth/strategies/local.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service.js';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email', // Customizes expected body parameter
      passwordField: 'password',
    });
  }

  async validate(email: string, pass: string): Promise<any> {
    const user = await this.authService.validateUser(email, pass);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user; // Injected into req.user
  }
}
```

### 2. Local Auth Guard

Encapsulate the magic string `'local'` in a strongly typed guard:

```typescript
// apps/api/src/auth/guards/local-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
```

---

## 3. Implementing JWT Authentication (Bearer Tokens)

### 1. JWT Strategy (`JwtStrategy`)

Inspects incoming `Authorization: Bearer <token>` headers, validates signatures, checks expiration, and extracts the payload:

```typescript
// apps/api/src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-insecure-secret-key-32-chars-min',
    });
  }

  async validate(payload: JwtPayload) {
    // Return value is assigned to request.user
    return {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles,
    };
  }
}
```

### 2. JWT Auth Guard

```typescript
// apps/api/src/auth/guards/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

---

## 4. Module Configuration (`AuthModule`)

Register `PassportModule` and `JwtModule`:

```typescript
// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { LocalStrategy } from './strategies/local.strategy.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-insecure-secret-key-32-chars-min',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

---

## 5. Global Authentication with `@Public()` Bypass

In secure enterprise architectures, all routes should be authenticated by default, with public routes explicitly opted-out using `@Public()`.

### Step 1: Create the `@Public()` Decorator

```typescript
// apps/api/src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### Step 2: Global `JwtAuthGuard` with Reflector Inspection

```typescript
// apps/api/src/auth/guards/global-jwt-auth.guard.ts
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';

@Injectable()
export class GlobalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

### Step 3: Register Globally via `APP_GUARD`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GlobalJwtAuthGuard } from './auth/guards/global-jwt-auth.guard.js';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: GlobalJwtAuthGuard,
    },
  ],
})
export class AppModule {}
```

---

## 6. GraphQL Integration (`GqlAuthGuard`)

Because GraphQL queries execute across a unified HTTP POST endpoint (`/graphql`), the standard HTTP `Request` object must be extracted from the GraphQL execution context:

```typescript
// apps/api/src/auth/guards/gql-auth.guard.ts
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }
}
```

### Current User Resolver Decorator

```typescript
// apps/api/src/common/decorators/current-user.decorator.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req.user;
  },
);
```

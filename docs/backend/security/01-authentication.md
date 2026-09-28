# 01 - Authentication

> **Source Reference**: [NestJS Official Documentation - Authentication](https://docs.nestjs.com/security/authentication)

Authentication verifies the identity of a client attempting to access application resources. In modern API architectures, authentication is typically handled via **JSON Web Tokens (JWT)**:
1. The client sends user credentials (username/email and password) to a login endpoint.
2. The server verifies the credentials against hashed records and issues a signed, cryptographically verified JWT.
3. The client attaches this token as a Bearer token in the `Authorization` header (`Bearer <token>`) on all subsequent requests.
4. Guards intercept the request, verify the token signature and expiration, and attach the decoded user identity to the request context.

---

## 1. Installation & Module Setup

```bash
pnpm --filter @aaraj/api add @nestjs/jwt
```

### Configuring `JwtModule` with `ConfigService`

Never hardcode JWT secrets in source code. Inject the secret and expiration settings dynamically from environment configuration:

```typescript
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true, // Makes JwtService available application-wide
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '15m'),
        },
      }),
    }),
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

---

## 2. Implementing `AuthService` (Issuing JWTs)

The `AuthService` retrieves the user, verifies the password against a cryptographic hash (e.g. via `bcrypt`), and generates the signed JWT:

```typescript
// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service.js';
import bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;      // Standard JWT subject claim (User ID)
  email: string;
  roles: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signIn(email: string, pass: string): Promise<{ accessToken: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Securely compare incoming plaintext password against database hash
    const isPasswordValid = await bcrypt.compare(pass, user.passwordHash);
    if (!isPasswordValid) {
      this.logger.warn(`Failed login attempt for user: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}
```

---

## 3. Implementing the Token Verification Guard (`AuthGuard`)

The `AuthGuard` extracts the Bearer token, validates its cryptographic signature and expiration timestamp (`exp`), and populates `request.user`:

```typescript
// src/auth/guards/auth.guard.ts
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { JwtPayload } from '../auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check if route is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true; // Bypass authentication
    }

    // 2. Extract Bearer token from Authorization header
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    try {
      // 3. Verify signature, issuer, and expiration time
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // 4. Attach decoded payload to request object for downstream controllers
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException('Token is invalid or has expired');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
```

---

## 4. Global Authentication & The `@Public()` Decorator

In production systems, **routes should be authenticated by default**. This fail-closed architecture ensures that engineers never accidentally expose sensitive endpoints by forgetting a `@UseGuards(AuthGuard)` decorator.

### Creating the `@Public()` Decorator

```typescript
// src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### Binding `AuthGuard` Globally in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/guards/auth.guard.js';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard, // Every endpoint in the API is now protected by default!
    },
  ],
})
export class AppModule {}
```

---

## 5. Controller Endpoints (`Public` vs `Protected`)

```typescript
// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Explicitly public: unauthenticated clients can log in
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() body: { email: string; pass: string }) {
    return this.authService.signIn(body.email, body.pass);
  }

  // Automatically protected by global AuthGuard
  @Get('profile')
  getProfile(@Req() req: Request) {
    // req.user was populated by AuthGuard:
    return req['user'];
  }
}
```

---

## 6. Access Token & Refresh Token Strategy

Short-lived access tokens (e.g. 15 minutes) reduce the window of vulnerability if a token is intercepted. Production systems pair them with long-lived **refresh tokens** (e.g. 7 days) stored securely in `httpOnly`, `Secure` cookies with database rotation tracking.

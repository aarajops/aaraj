# WebSockets: Guards

> **Source**: https://docs.nestjs.com/websockets/guards  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Guards](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/overview/08-guards.md) in WebSockets evaluate permissions, roles, and authentication claims before a message handler is invoked.

There is no fundamental structural difference between WebSocket guards and HTTP guards: both implement the `CanActivate` interface and evaluate the incoming execution context. However, over WebSockets:
- **Return Semantics**: If a guard returns `false`, Nest automatically throws a `WsException` with the message `'Forbidden resource'`.
- **Custom Exceptions**: If access is denied, guards should throw an explicit `WsException` rather than an `HttpException` (e.g., `UnauthorizedException`).

---

## 1. Connection-Level Authentication vs. Message-Level Guards

A critical architectural distinction must be observed when securing WebSockets:

| Lifecycle Stage | Mechanism | Purpose | Action on Failure |
| :--- | :--- | :--- | :--- |
| **Transport Handshake** | `handleConnection()` in Gateway or Adapter Middleware | Validates identity at TCP/WebSocket connection time. | Calls `client.disconnect(true)` to terminate the socket immediately. |
| **Message Ingress** | `@UseGuards()` on `@SubscribeMessage()` | Enforces granular authorizations (e.g., room membership, RBAC, tenant checks) per packet. | Rejects the specific message by emitting `{ status: 'error', message: 'Forbidden resource' }` without closing the connection. |

> [!IMPORTANT]
> WebSocket guards decorated on `@SubscribeMessage()` run **only when a message packet arrives**. They do not run during the initial HTTP upgrade / connection handshake. Initial connection security belongs inside `handleConnection()` or an adapter handshake middleware.

---

## 2. Accessing the WebSocket Execution Context

Inside a guard, inspect the WebSocket context using `context.switchToWs()`:

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const wsContext = context.switchToWs();
    const client = wsContext.getClient<Socket>();
    const data = wsContext.getData<unknown>();

    // Socket.io transports auth credentials in client.handshake.auth or headers
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    return true;
  }
}
```

---

## 3. Binding Guards

Guards can be bound at the method, gateway, or global level:

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  UseGuards,
  MessageBody,
  ConnectedSocket,
  WsResponse,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { WsAuthGuard } from './guards/ws-auth.guard.js';
import { WsRolesGuard } from './guards/ws-roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

// Gateway-scoped guard: Applies to all message handlers in this gateway
@UseGuards(WsAuthGuard)
@WebSocketGateway({ namespace: 'admin' })
export class AdminGateway {
  // Method-scoped guard with role metadata
  @UseGuards(WsRolesGuard)
  @Roles('admin', 'superadmin')
  @SubscribeMessage('systemBroadcast')
  handleBroadcast(
    @MessageBody() payload: { announcement: string },
    @ConnectedSocket() client: Socket,
  ): WsResponse<{ dispatched: boolean }> {
    return {
      event: 'broadcastDispatched',
      data: { dispatched: true },
    };
  }
}
```

### 3.1 Global Guards Across Transports

If you bind a guard globally using `app.useGlobalGuards()` or `APP_GUARD`, ensure the guard checks the context transport type:

```typescript
@Injectable()
export class UniversalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const type = context.getType();

    if (type === 'http') {
      const request = context.switchToHttp().getRequest();
      return this.validateHttpRequest(request);
    }

    if (type === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      return this.validateWsSocket(client);
    }

    return true;
  }

  private validateHttpRequest(req: unknown): boolean {
    // HTTP token logic
    return true;
  }

  private validateWsSocket(client: Socket): boolean {
    // WebSocket socket.handshake logic
    return true;
  }
}
```

---

## 4. Complete Production Example: JWT Authentication & Role-Based Access

The following pattern demonstrates authenticating incoming sockets, validating JWT signatures, caching user profiles on `client.data`, and enforcing role-based message permissions:

```typescript
// src/common/guards/ws-jwt-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
}

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();

    // If already authenticated during connection handshake, pass through
    if (client.data.user) {
      return true;
    }

    const token =
      client.handshake.auth?.token ||
      (client.handshake.headers?.authorization?.startsWith('Bearer ')
        ? client.handshake.headers.authorization.slice(7)
        : null);

    if (!token) {
      this.logger.warn(`Unauthorized WebSocket access attempt on socket ${client.id}`);
      throw new WsException('Unauthorized: Missing bearer token');
    }

    try {
      // In production, verify JWT with JwtService:
      // const user = this.jwtService.verify<AuthenticatedUser>(token);
      const user: AuthenticatedUser = this.verifyToken(token);

      // Attach user identity to the socket instance for subsequent handlers
      client.data.user = user;
      return true;
    } catch (err) {
      throw new WsException('Unauthorized: Token invalid or expired');
    }
  }

  private verifyToken(token: string): AuthenticatedUser {
    // Mock token verification for demonstration
    if (token === 'valid-admin-token') {
      return { id: 'usr_admin', email: 'admin@aaraj.io', roles: ['admin'] };
    }
    if (token === 'valid-user-token') {
      return { id: 'usr_member', email: 'user@aaraj.io', roles: ['user'] };
    }
    throw new Error('Invalid token');
  }
}
```

### 4.1 RBAC Metadata Guard

```typescript
// src/common/guards/ws-roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import type { AuthenticatedUser } from './ws-jwt-auth.guard.js';

@Injectable()
export class WsRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const client = context.switchToWs().getClient<Socket>();
    const user = client.data.user as AuthenticatedUser | undefined;

    if (!user || !user.roles) {
      throw new WsException('Forbidden: Insufficient privileges');
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new WsException(`Forbidden: Requires one of [${requiredRoles.join(', ')}]`);
    }

    return true;
  }
}
```

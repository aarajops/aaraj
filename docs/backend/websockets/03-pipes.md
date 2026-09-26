# WebSockets: Pipes

> **Source**: https://docs.nestjs.com/websockets/pipes  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

In NestJS WebSockets, [Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/07-pipes.md) perform the exact same two core responsibilities as in HTTP controllers:
1. **Transformation**: Converting raw message payloads into the expected internal data types (e.g., parsing strings into integers or instantiating domain models).
2. **Validation**: Evaluating incoming payloads against schema contracts and rejecting malformed or malicious packets before they reach the message handler.

However, a critical distinction governs real-time messaging: **Pipes must throw `WsException` rather than `HttpException`**.

---

## 1. The Validation Pipe Gotcha: `WsException` Factory

In HTTP requests, `ValidationPipe` throws a `BadRequestException` upon schema validation failure, which produces a `400 Bad Request` HTTP response.

In a WebSocket gateway, any non-`WsException` (including `BadRequestException` and all other `HttpException` subclasses) is caught by the core exception filter and converted into a generic `'Internal server error'` string. As a result, the client never receives the validation error messages.

To ensure validation errors reach the client, configure `ValidationPipe` with a custom `exceptionFactory` that wraps errors in `WsException`:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export const wsValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => new WsException(errors),
});
```

---

## 2. Binding Scopes

Unlike WebSocket exception filters (which ignore global registration), **global pipes apply to WebSocket gateways**:

| Scope | Registration Method | Target |
| :--- | :--- | :--- |
| **Global Scope** | `app.useGlobalPipes(wsValidationPipe)` or `APP_PIPE` token | Applies to all HTTP routes, microservices, and WebSocket gateways across the entire application. |
| **Gateway Scope** | `@UsePipes(wsValidationPipe)` on the gateway class | Applies to all message handlers within that specific gateway. |
| **Method Scope** | `@UsePipes(wsValidationPipe)` on the handler method | Applies to that individual message event handler. |
| **Parameter Scope** | `@MessageBody(new ParseIntPipe())` or `@MessageBody('id', ParseIntPipe)` | Applies exclusively to that specific parameter. |

> [!IMPORTANT]
> **Parameter-Level vs Handler-Level Pipes**:
> Method-, gateway-, and global-scoped pipes run for **every parameter** of the handler method (including `@ConnectedSocket()` or `@Ack()`). To validate or transform **only** the incoming message payload, bind the pipe directly at the parameter level via `@MessageBody()`.

```typescript
// src/events/events.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  UsePipes,
  WsResponse,
} from '@nestjs/websockets';
import { ParseIntPipe, ParseUUIDPipe } from '@nestjs/common';

@WebSocketGateway({ namespace: 'catalog' })
export class CatalogGateway {
  /**
   * Parameter-level pipe extracting and casting an integer.
   */
  @SubscribeMessage('getItem')
  handleGetItem(
    @MessageBody('id', ParseIntPipe) id: number,
  ): WsResponse<{ id: number; name: string }> {
    return {
      event: 'itemFound',
      data: { id, name: `Widget #${id}` },
    };
  }

  /**
   * Parameter-level pipe validating a UUID string.
   */
  @SubscribeMessage('getRecord')
  handleGetRecord(
    @MessageBody('uuid', new ParseUUIDPipe({ version: '4' })) uuid: string,
  ): string {
    return `Record ${uuid} processed`;
  }
}
```

---

## 3. Modern Schema-Based Validation (Standard Schema V1 & Zod)

NestJS v11 and v12 introduce native support for [Standard Schema](https://standardschema.dev/) specifications (compatible with [Zod](https://zod.dev/), Valibot, and ArkType).

Just like HTTP route parameters, the `@MessageBody()` decorator accepts an options object containing a `schema` property. The built-in `StandardSchemaValidationPipe` evaluates the payload against the schema, passing non-annotated parameters through untouched.

### 3.1 Defining a Zod Schema Contract

```typescript
// src/chat/dto/send-message.schema.ts
import { z } from 'zod';

export const SendMessageSchema = z.object({
  roomId: z.string().uuid(),
  text: z.string().min(1).max(1000),
  priority: z.enum(['low', 'normal', 'urgent']).default('normal'),
  attachments: z.array(z.string().url()).optional(),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;
```

### 3.2 Binding `StandardSchemaValidationPipe` with `WsException`

```typescript
// src/chat/chat.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  UsePipes,
} from '@nestjs/websockets';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import {
  SendMessageSchema,
  type SendMessageDto,
} from './dto/send-message.schema.js';

@WebSocketGateway({ namespace: 'chat' })
export class ChatGateway {
  @UsePipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new WsException({
          code: 'VALIDATION_FAILED',
          message: 'Malformed message payload',
          issues,
        }),
    }),
  )
  @SubscribeMessage('sendMessage')
  handleSendMessage(
    @MessageBody({ schema: SendMessageSchema }) payload: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ): { status: string; messageId: string } {
    return {
      status: 'dispatched',
      messageId: `msg_${Date.now()}`,
    };
  }
}
```

### 3.3 Extracting and Validating a Single Property

To isolate and validate a single property inside an incoming payload, pass the property key as the first argument, followed by the schema options:

```typescript
import { SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { z } from 'zod';

@SubscribeMessage('updateStock')
handleUpdateStock(
  @MessageBody('quantity', { schema: z.number().int().positive() })
  quantity: number,
): string {
  return `Updated stock by ${quantity} units`;
}
```

---

## 4. Custom Parameter Transformation Pipe

When incoming WebSocket packets require custom transformation (e.g., parsing binary buffers or decrypting encrypted payloads):

```typescript
// src/common/pipes/decrypt-payload.pipe.ts
import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class DecryptPayloadPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (typeof value !== 'string') {
      throw new WsException('Payload must be an encrypted base64 string');
    }

    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      throw new WsException('Unable to decrypt or parse incoming payload');
    }
  }
}
```

Apply the custom transformation pipe to the message body:

```typescript
@SubscribeMessage('secureData')
handleSecureData(
  @MessageBody(DecryptPayloadPipe) decryptedData: Record<string, unknown>,
): { status: string } {
  return { status: 'processed' };
}
```

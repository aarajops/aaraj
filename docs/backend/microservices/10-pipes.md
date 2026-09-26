# Microservices: Pipes

> **Source**: https://docs.nestjs.com/microservices/pipes  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@nestjs/common`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Pipes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/07-pipes.md) in microservices operate identically to their HTTP counterparts, providing schema validation and data transformation before message payloads reach pattern handlers.

The critical requirement: **Pipes must throw `RpcException` instead of `HttpException`**. Any uncaught `BadRequestException` is converted by the core exception filter into a generic `'Internal server error'`.

---

## 1. Class-Validator via `ValidationPipe` & `RpcException`

When using decorator-based DTOs (`class-validator`), configure `ValidationPipe` with a custom `exceptionFactory`:

```typescript
// src/common/pipes/rpc-validation.pipe.ts
import { ValidationPipe } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

export const rpcValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => new RpcException(errors),
});
```

Apply the pipe at the method or controller level:

```typescript
// src/users/users.controller.ts
import { Controller, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { rpcValidationPipe } from '../common/pipes/rpc-validation.pipe.js';
import { CreateUserDto } from './dto/create-user.dto.js';

@Controller()
export class UsersController {
  @UsePipes(rpcValidationPipe)
  @MessagePattern('users.create')
  createUser(@Payload() dto: CreateUserDto) {
    return { id: 'usr_new', ...dto };
  }
}
```

---

## 2. Modern Standard Schema V1 & Zod Contracts

NestJS supports the [Standard Schema](https://standardschema.dev/) specification. The `@Payload()` decorator accepts a `schema` property that executes via `StandardSchemaValidationPipe`:

```typescript
// src/orders/orders.controller.ts
import { Controller, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { z } from 'zod';

const CalculateTaxSchema = z.object({
  subtotal: z.number().positive(),
  countryCode: z.string().length(2),
  exempt: z.boolean().default(false),
});

type CalculateTaxDto = z.infer<typeof CalculateTaxSchema>;

@Controller()
export class OrdersController {
  @UsePipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new RpcException({
          code: 'INVALID_PAYLOAD',
          issues,
        }),
    }),
  )
  @MessagePattern('orders.calculateTax')
  calculateTax(@Payload({ schema: CalculateTaxSchema }) data: CalculateTaxDto) {
    const rate = data.exempt ? 0 : 0.2;
    return { tax: data.subtotal * rate };
  }
}
```

---

## 3. Hybrid Applications & Global Pipe Inheritance

In hybrid applications created with `app.connectMicroservice()`, global pipes configured via `app.useGlobalPipes()` **do not apply** to microservices unless `inheritAppConfig: true` is explicitly provided during connection:

```typescript
app.connectMicroservice<MicroserviceOptions>(
  { transport: Transport.TCP, options: { port: 8877 } },
  { inheritAppConfig: true },
);
```

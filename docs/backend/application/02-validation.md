# 02 - Validation

> **Source Reference**: [NestJS Official Documentation - Validation](https://docs.nestjs.com/application/validation)

Data received across HTTP, WebSockets, or RPC boundaries must be rigorously validated before application logic executes. NestJS provides an extensible validation pipeline supporting two distinct paradigms:
1. **Schema-Based Validation (`StandardSchemaValidationPipe`)**: Uses modern [Standard Schema](https://standardschema.dev/) compatible libraries (such as **Zod**, **Valibot**, and **ArkType**). Schemas act as the single source of truth; TypeScript types are inferred without runtime reflection metadata.
2. **Decorator-Based Validation (`ValidationPipe`)**: Uses [`class-validator`](https://github.com/typestack/class-validator) and [`class-transformer`](https://github.com/typestack/class-transformer) decorators on class definitions.

In modern monorepos such as `@araz`, **Schema-Based Validation** with Zod is the primary standard because it allows contracts to be shared verbatim across client and server applications in `packages/contracts`.

---

## 1. Comparing Validation Approaches

| Feature | `StandardSchemaValidationPipe` (Zod / Standard Schema) | `ValidationPipe` (`class-validator`) |
| :--- | :--- | :--- |
| **Source of Truth** | Pure schema object (e.g. `z.object({...})`) | Class decorated with property decorators |
| **Type Inference** | `z.infer<typeof schema>` | Native TypeScript class type |
| **Monorepo Sharing** | Direct zero-dependency JS/TS sharing with web/mobile | Requires bundling TS decorators & experimental reflection |
| **Reflection / Metadata** | None (`reflect-metadata` not required) | Heavy reliance on `emitDecoratorMetadata` |
| **Coercion & Defaults** | Native in schema (`z.coerce`, `.default()`, `.transform()`) | Requires `class-transformer` plainToInstance rules |
| **Handling Unknown Keys** | Configurable via `z.object()` (strip), `z.strictObject()` (reject) | Configurable via `whitelist`, `forbidNonWhitelisted` |

Both pipes can be registered simultaneously: `ValidationPipe` only evaluates parameters typed with decorated classes, while `StandardSchemaValidationPipe` only evaluates parameters that specify a `schema`.

---

## 2. Shared Contracts with Zod (`packages/contracts`)

Define schemas in the shared contracts package so both backend controllers and frontend forms share identical rules and error constraints:

```typescript
// packages/contracts/src/users/create-user.schema.ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters'),
  displayName: z.string().min(2).max(50).optional(),
  age: z.coerce.number().int().min(18).max(120).optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
```

---

## 3. Global Pipeline Registration

For clean dependency injection and testability, register the `StandardSchemaValidationPipe` as an `APP_PIPE` multi-provider in `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';

@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        transform: true, // Automatically applies schema transforms and defaults
        validateCustomDecorators: true, // Validates custom param decorators
      }),
    },
  ],
})
export class AppModule {}
```

Alternatively, for basic setups in `apps/api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  await app.listen(3000);
}
bootstrap();
```

---

## 4. Parameter Validation & Route Handlers

The `schema` option can be passed to parameter decorators (`@Body()`, `@Query()`, `@Param()`, `@MessageBody()`, `@Payload()`):

### Validating Request Bodies (`@Body`)

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { createUserSchema, type CreateUserDto } from '@araz/contracts';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(
    @Body({ schema: createUserSchema }) createUserDto: CreateUserDto,
  ) {
    return this.usersService.create(createUserDto);
  }
}
```

If validation fails, NestJS immediately responds with `400 Bad Request` and structured issue details:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": [
    "email: Invalid email address format",
    "password: Password must be at least 8 characters"
  ]
}
```

### Validating Path & Query Parameters (`@Param`, `@Query`)

Path and query parameters always enter the Node runtime as raw strings. Use `z.coerce` to convert types before validation:

```typescript
// Path parameter validation
@Get(':id')
async findOne(
  @Param('id', { schema: z.coerce.number().int().positive() }) id: number,
) {
  return this.usersService.findById(id);
}
```

```typescript
// Query parameter validation with defaults and trimming
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});

export type ListQueryDto = z.infer<typeof listQuerySchema>;

@Get()
async findAll(
  @Query({ schema: listQuerySchema }) query: ListQueryDto,
) {
  // query.page is guaranteed to be a number (default 1)
  // query.limit is guaranteed to be a number (default 20)
  return this.usersService.findAll(query);
}
```

---

## 5. Array Validation & Bulk Operations

Arrays require no external wrapper classes with Standard Schema. Simply wrap the schema with `z.array()`:

```typescript
@Post('bulk')
async createMany(
  @Body({ schema: z.array(createUserSchema).min(1).max(500) })
  users: CreateUserDto[],
) {
  return this.usersService.createBulk(users);
}
```

Validation errors on nested items include the index in the message path (e.g. `2.email: Invalid email address format`).

---

## 6. Deriving & Composing Schemas

In CRUD applications, update endpoints frequently need to relax or modify create rules. Zod provides programmatic composition methods:

```typescript
import { z } from 'zod';
import { createUserSchema } from './create-user.schema.js';

// 1. Partial: All fields optional (equivalent to PartialType)
export const updateUserSchema = createUserSchema.partial();
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// 2. Pick: Select specific keys (equivalent to PickType)
export const updateEmailSchema = createUserSchema.pick({ email: true });

// 3. Omit: Exclude specific keys (equivalent to OmitType)
export const publicProfileSchema = createUserSchema.omit({ password: true });

// 4. Extend: Add new keys (equivalent to IntersectionType)
export const createAdminSchema = createUserSchema.extend({
  role: z.enum(['admin', 'editor', 'viewer']),
  permissions: z.array(z.string()).min(1),
});
```

---

## 7. Validating Custom Decorators

When using custom parameter decorators (e.g. `@CurrentUser()`, `@TenantId()`), ensure `validateCustomDecorators: true` is configured on the pipe:

```typescript
// src/common/decorators/tenant-id.decorator.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['x-tenant-id'];
  },
);
```

```typescript
// Controller usage:
@Get('tenants/current')
async getTenantData(
  @TenantId({ schema: z.string().uuid('Invalid tenant identifier') })
  tenantId: string,
) {
  return this.tenantService.getDetails(tenantId);
}
```

---

## 8. Customizing Error Formatting (`exceptionFactory`)

By default, the pipe throws `BadRequestException` (HTTP 400). You can format error responses to match RFC 7807 Problem Details or custom API envelopes:

```typescript
import {
  StandardSchemaValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';

export const customValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
  exceptionFactory: (issues) => {
    return new UnprocessableEntityException({
      error: 'Unprocessable Entity',
      statusCode: 422,
      details: issues.map((issue) => {
        const path = issue.path
          ?.map((segment) =>
            typeof segment === 'object' ? segment.key : segment,
          )
          .join('.');
        return {
          field: path ?? 'unknown',
          message: issue.message,
        };
      }),
    });
  },
});
```

Produces:
```json
{
  "error": "Unprocessable Entity",
  "statusCode": 422,
  "details": [
    {
      "field": "email",
      "message": "Invalid email address format"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters"
    }
  ]
}
```

---

## 9. Legacy `ValidationPipe` Reference (`class-validator`)

If maintaining legacy codebases utilizing `class-validator`:

```typescript
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class LegacyCreateUserDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}
```

To configure `ValidationPipe` safely in production:
```typescript
new ValidationPipe({
  whitelist: true,            // Strips un-decorated properties
  forbidNonWhitelisted: true, // Rejects request if unexpected properties exist
  transform: true,            // Automatically converts primitive strings to numbers/booleans
  disableErrorMessages: process.env.NODE_ENV === 'production', // Prevent data leaks in prod
})
```

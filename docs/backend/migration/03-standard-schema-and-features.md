# Standard Schema & New Architectural Features

> **Domain**: Standard Schema V1, Zod Contracts, Route Diagnostics & Error Coding  
> **Framework Compatibility**: NestJS v12.x  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

NestJS 12 introduces first-class support for the [Standard Schema](https://standardschema.dev/) specification, bridging the gap between frontend TypeScript contracts (Zod, Valibot, ArkType) and backend pipes, interceptors, and configuration modules without reflection overhead.

---

## 1. Route Parameter Schema Validation

Decorators such as `@Body()`, `@Query()`, `@Param()`, and `@RawBody()` accept a `schema` parameter:

```typescript
import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
});

type CreateUserDto = z.infer<typeof createUserSchema>;

@Controller('users')
export class UsersController {
  @Post()
  create(@Body({ schema: createUserSchema }) body: CreateUserDto) {
    return { created: true, email: body.email };
  }

  @Get(':id')
  findOne(
    @Param('id', { schema: z.coerce.number().int().positive() }) id: number,
  ) {
    return { userId: id };
  }
}
```

### Global Binding (`StandardSchemaValidationPipe`)

Register the built-in pipe globally in `main.ts` or as an `APP_PIPE` provider:

```typescript
import { NestFactory } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Activates validation for all route decorator schemas
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  await app.listen(3000);
}
await bootstrap();
```

---

## 2. Standard Schema Serialization (`StandardSchemaSerializerInterceptor`)

Replace reflection-heavy `class-transformer` decorators with a schema that shapes and strips outgoing response objects:

```typescript
import { Controller, Get, UseInterceptors, SerializeOptions } from '@nestjs/common';
import { StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { z } from 'zod';

const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  // Password hash is omitted from the schema and will be stripped automatically
});

@UseInterceptors(StandardSchemaSerializerInterceptor)
@Controller('profile')
export class ProfileController {
  @SerializeOptions({ schema: userResponseSchema })
  @Get()
  getProfile() {
    return {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      email: 'alex@example.com',
      passwordHash: '$2b$12$e8Yk...', // Stripped!
    };
  }
}
```

---

## 3. Standard Schema in `@nestjs/config`

`@nestjs/config` shifts from Joi-only validation to Standard Schema, allowing Zod to validate environment variables directly:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: z.object({
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        PORT: z.coerce.number().default(3000),
        DATABASE_URL: z.string().url(),
      }),
    }),
  ],
})
export class AppModule {}
```

> **Joi Legacy Migration**: Existing Joi schemas require **Joi v18+**. Any custom options previously passed under `validationOptions` must be nested under `validationOptions.libraryOptions`.

---

## 4. Route Conflict Policies & Resolution Order

In Express-based adapters, declaration order determines routing: `@Get(':id')` silently shadows a `@Get('me')` declared after it. NestJS 12 adds opt-in conflict detection:

```typescript
const app = await NestFactory.create(AppModule, {
  routeConflictPolicy: {
    duplicate: 'error', // Throws exception on identical endpoints
    shadow: 'warn',     // Warns when a parameterized route shadows a static route
  },
  routeResolutionStrategy: 'specificity', // Prioritizes exact matches over wildcards
});
```

---

## 5. Machine-Readable Error Codes

`HttpException` and its subclasses accept an `errorCode` option, serialized into the response body:

```typescript
throw new BadRequestException('Password does not meet complexity requirements', {
  errorCode: 'AUTH_WEAK_PASSWORD',
});
```

Produces:
```json
{
  "statusCode": 400,
  "message": "Password does not meet complexity requirements",
  "errorCode": "AUTH_WEAK_PASSWORD"
}
```

---

## 6. Structured Logging in `ConsoleLogger`

Objects passed after log messages are now captured as structured properties rather than printed as independent strings:

```typescript
// Logs a single JSON object containing params in production
this.logger.log('Payment processed', { transactionId: 'tx_123', amount: 99.99 });
```

In `main.ts`, toggle flat spreading or legacy formatting:
```typescript
const app = await NestFactory.create(AppModule, {
  logger: new ConsoleLogger({
    json: true,
    flattenParams: true, // Merges params directly into root JSON payload
  }),
});
```

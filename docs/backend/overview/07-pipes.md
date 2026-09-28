# 07 - Pipes

> **Source Reference**: [NestJS Official Documentation - Pipes](https://docs.nestjs.com/pipes)

A pipe is an `@Injectable()` class implementing the `PipeTransform` interface. Pipes operate on the arguments destined for a route handler immediately before the method is invoked.

Pipes serve two primary purposes:
1. **Transformation**: Transform input data into the desired shape or type (e.g., parsing a string `'42'` into integer `42`).
2. **Validation**: Evaluate incoming data against schema constraints, passing it through unchanged if valid, or throwing an `HttpException` (typically `BadRequestException`) if invalid.

> **Exception Zone Guarantee**: Pipes run inside the Nest exceptions zone. Any exception thrown by a pipe halts the request-response cycle immediately; the route handler is never executed, protecting downstream services from malformed data.

---

## 1. Built-in Transformation Pipes

Nest provides a comprehensive set of built-in transformation pipes exported from `@nestjs/common`:

| Pipe | Purpose | Example Route Usage |
| :--- | :--- | :--- |
| `ParseIntPipe` | Converts string to integer | `@Param('id', ParseIntPipe) id: number` |
| `ParseFloatPipe` | Converts string to float | `@Query('price', ParseFloatPipe) price: number` |
| `ParseBoolPipe` | Converts string (`'true'`/`'false'`) to boolean | `@Query('active', ParseBoolPipe) active: boolean` |
| `ParseUUIDPipe` | Verifies and enforces UUID string (v3, v4, v5, v7) | `@Param('uuid', new ParseUUIDPipe({ version: '4' })) id: string` |
| `ParseEnumPipe` | Validates string matches TypeScript enum | `@Query('role', new ParseEnumPipe(UserRole)) role: UserRole` |
| `ParseDatePipe` | Parses string into Date object | `@Query('since', ParseDatePipe) since: Date` |
| `ParseArrayPipe` | Parses delimited string or array of items | `@Query('ids', new ParseArrayPipe({ items: Number, separator: ',' })) ids: number[]` |
| `DefaultValuePipe` | Injects default value if parameter is undefined | `@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number` |
| `ParseFilePipe` | Validates uploaded files (size, MIME type) | `@UploadedFile(new ParseFilePipe({ ... })) file: Express.Multer.File` |

---

## 2. Binding Transformation Pipes

Pipes can be bound by **class reference** (allowing Nest to instantiate and reuse singletons) or by **instance** (to pass configuration options):

```typescript
import { Controller, Get, Param, Query, ParseIntPipe, ParseUUIDPipe, HttpStatus } from '@nestjs/common';

@Controller('products')
export class ProductsController {
  // Bound by class reference
  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number) {
    return { id };
  }

  // Bound by instance with custom error status code
  @Get('item/:uuid')
  findByUuid(
    @Param(
      'uuid',
      new ParseUUIDPipe({
        version: '4',
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY, // 422 instead of 400
      }),
    )
    uuid: string,
  ) {
    return { uuid };
  }
}
```

---

## 3. Schema-Based Validation & Modern Standard Schema V1

In modern full-stack architectures, validating request payloads with **Standard Schema** (e.g. [Zod](https://zod.dev/)) provides immense advantages:
* Shared validation logic across frontend and backend.
* Compile-time type inference (`z.infer<typeof schema>`).
* Zero reflection overhead compared to legacy `class-validator` setups.

### Native NestJS 12 Standard Schema Support

In NestJS 12, `ArgumentMetadata` includes a `schema?: StandardSchemaV1` property. Using `StandardSchemaValidationPipe`, any Standard Schema-compatible schema (including Zod) can be attached directly:

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { z } from 'zod';

export const CreateProductSchema = z.object({
  title: z.string().min(3).max(100),
  price: z.number().positive(),
  sku: z.string().regex(/^[A-Z0-9-]+$/),
});

export type CreateProductDto = z.infer<typeof CreateProductSchema>;

@Controller('products')
export class ProductsController {
  @Post()
  create(
    @Body(new StandardSchemaValidationPipe(CreateProductSchema))
    createProductDto: CreateProductDto,
  ) {
    return createProductDto;
  }
}
```

### Integration with Monorepo Contracts (`@aaraj/contracts`)

In the Aaraj monorepo, all DTOs and schemas are housed in `packages/contracts`:
```typescript
import { Controller, Post, Body, UsePipes } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { CreateUserContract, type CreateUserDto } from '@aaraj/contracts';

@Controller('users')
export class UsersController {
  @Post()
  @UsePipes(new StandardSchemaValidationPipe(CreateUserContract))
  async createUser(@Body() dto: CreateUserDto) {
    // dto is fully type-safe and guaranteed valid at runtime
    return this.usersService.create(dto);
  }
}
```

---

## 4. Custom Pipes & The `PipeTransform` Contract

Every pipe must implement `PipeTransform<T, R>`:

```typescript
import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

@Injectable()
export class ParseTimestampPipe implements PipeTransform<string, Date> {
  transform(value: string, metadata: ArgumentMetadata): Date {
    const timestamp = Date.parse(value);
    if (isNaN(timestamp)) {
      throw new BadRequestException(`Validation failed: "${value}" is not a valid ISO date timestamp`);
    }
    return new Date(timestamp);
  }
}
```

### Anatomy of `ArgumentMetadata`
The second argument passed to `transform()` describes the parameter:

```typescript
export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom'; // Where the parameter originated
  metatype?: Type<unknown>;                    // Parameter design type (e.g. Number, String, CreateDto)
  data?: string;                               // String passed to decorator (e.g. 'id' in @Param('id'))
  schema?: StandardSchemaV1;                   // Standard Schema instance attached to parameter
}
```

---

## 5. Providing Defaults with `DefaultValuePipe`

To handle optional query parameters cleanly, place `DefaultValuePipe` **before** the transformation pipe:

```typescript
import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, ParseBoolPipe } from '@nestjs/common';

@Controller('catalog')
export class CatalogController {
  @Get()
  getCatalog(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('inStockOnly', new DefaultValuePipe(false), ParseBoolPipe) inStockOnly: boolean,
  ) {
    return { page, limit, inStockOnly };
  }
}
```

---

## 6. Global-Scoped Pipes

To apply validation across the entire application:

### Global Registration in Module (Recommended with DI)
```typescript
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';

@Module({
  providers: [
    {
      provide: APP_PIPE,
      useClass: StandardSchemaValidationPipe,
    },
  ],
})
export class AppModule {}
```

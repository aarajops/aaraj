# Types, Parameters & Schemas

> **Domain**: OpenAPI Schema Modeling & Parameter Reflection  
> **Source Reference**: [NestJS Types and Parameters](https://docs.nestjs.com/openapi/types-and-parameters)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

`SwaggerModule` inspects route parameters annotated with `@Body()`, `@Query()`, `@Param()`, and `@Headers()` to construct the request contract in the OpenAPI specification. It reflects TypeScript metadata and combines it with explicit decorators or AST compiler plugins to build comprehensive OpenAPI schema models under `components.schemas`.

---

## 1. DTO Model Reflection & `@ApiProperty()`

By default, TypeScript metadata reflection does not serialize property keys or validation constraints of a class at runtime. If a DTO is not decorated, Swagger UI renders an empty model object `{}`.

To expose properties to OpenAPI, annotate them with `@ApiProperty()` or `@ApiPropertyOptional()`:

```typescript
// apps/api/src/cats/dto/create-cat.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCatDto {
  @ApiProperty({
    description: 'The distinct breed of the cat',
    example: 'Maine Coon',
  })
  breed!: string;

  @ApiProperty({
    description: 'The age in completed years',
    minimum: 0,
    maximum: 30,
    default: 1,
    example: 3,
  })
  age!: number;

  @ApiPropertyOptional({
    description: 'Special dietary requirements or notes',
    example: 'Hypoallergenic wet food',
  })
  dietNotes?: string;
}
```

> [!TIP]
> **Automate with the CLI Plugin**: Instead of manually annotating every property with `@ApiProperty()`, enable the [Swagger CLI Plugin](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/07-cli-plugin.md) in `nest-cli.json`. It automatically extracts types, optionality (`?`), defaults, and JSDoc comments into OpenAPI schemas at compile time.

---

## 2. Array Typing

For arrays, specify the contained element type using array literal syntax or `isArray: true`:

```typescript
export class BatchCatDto {
  // Option 1: Array literal notation (preferred)
  @ApiProperty({ type: [String], example: ['Oliver', 'Luna', 'Milo'] })
  names!: string[];

  // Option 2: isArray flag
  @ApiProperty({ type: String, isArray: true })
  tags!: string[];
}
```

---

## 3. Circular Dependencies

When models circularly reference each other (e.g., parent-child trees or graph nodes), eager evaluation causes runtime `ReferenceError` during module loading. Resolve this with lazy type functions:

```typescript
// apps/api/src/nodes/dto/node.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NodeDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: () => NodeDto, isArray: true })
  children?: NodeDto[];

  @ApiPropertyOptional({ type: () => NodeDto })
  parent?: NodeDto;
}
```

---

## 4. Generics and Interfaces

TypeScript interfaces and generic type parameters (e.g. `Array<T>`, `Response<T>`) are completely erased during compilation and produce no runtime metadata. If a controller consumes an array or generic type directly:

```typescript
@Post('bulk')
async createBulk(@Body() usersDto: CreateUserDto[]) {}
```

Swagger cannot determine the element schema automatically. Overcome this by explicitly supplying `@ApiBody()`:

```typescript
@Post('bulk')
@ApiBody({ type: [CreateUserDto] })
async createBulk(@Body() usersDto: CreateUserDto[]) {}
```

---

## 5. Enums & The Client Code Generation Duplication Fix

Enums can be supplied as raw string arrays or TypeScript `enum` objects:

```typescript
export enum UserRole {
  ADMIN = 'Admin',
  MODERATOR = 'Moderator',
  USER = 'User',
}

export class UserDto {
  @ApiProperty({ enum: UserRole, default: UserRole.USER })
  role!: UserRole;
}
```

In query parameters, enums integrate with `@ApiQuery()`:

```typescript
@Get()
@ApiQuery({ name: 'role', enum: UserRole, required: false })
async filterByRole(@Query('role') role: UserRole = UserRole.USER) {}

// For multi-select enum query filters:
@Get('multi')
@ApiQuery({ name: 'roles', enum: UserRole, isArray: true, required: false })
async filterByRoles(@Query('roles') roles: UserRole[]) {}
```

### The `enumName` Requirement for Reusable Schemas

By default, passing `enum: UserRole` inlines the enum array directly into each parameter definition. When client SDK generators (such as NSwag, Orval, or openapi-generator) generate frontend code, they produce **duplicate identical enums** (`CatDetailRole`, `CatInfoRole`):

```typescript
// Flawed generated client SDK:
export enum CatDetailRole { ADMIN = 'Admin', USER = 'User' }
export enum CatInfoRole   { ADMIN = 'Admin', USER = 'User' }
```

To enforce schema reuse, always provide `enumName`:

```typescript
export class UserDto {
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role!: UserRole;
}
```

This instructs Swagger to extract `UserRole` into `#/components/schemas/UserRole` and reference it via `$ref`.

---

## 6. Examples (Single vs. Multiple Named Examples)

```typescript
export class CatProfileDto {
  // Single property example:
  @ApiProperty({ example: 'Whiskers' })
  name!: string;

  // Multiple named property examples:
  @ApiProperty({
    examples: {
      Persian: {
        summary: 'Persian cat example',
        value: 'Persian Longhair',
      },
      Siamese: {
        summary: 'Siamese cat example',
        value: 'Traditional Siamese',
      },
    },
  })
  breed!: string;
}
```

---

## 7. Raw Schema Definitions & Multi-Dimensional Matrices

For complex types not easily mapped to a TypeScript class—such as 2D coordinate matrices (`number[][]`) or unstructured dictionary payloads—use raw schema definitions:

```typescript
// 2D Coordinate Matrix
export class GeometryDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'number',
      },
    },
    example: [[40.7128, -74.0060], [34.0522, -118.2437]],
  })
  coordinates!: number[][];
}

// Unstructured Metadata Record
export class MetadataDto {
  @ApiProperty({
    type: 'object',
    properties: {
      traceId: { type: 'string', example: 'c0a80101-0001' },
      retries: { type: 'number', example: 3 },
    },
    required: ['traceId'],
  })
  rawMeta!: Record<string, unknown>;
}
```

---

## 8. Extra Models & Polymorphic Schemas (`oneOf`, `anyOf`, `allOf`)

When models are not referenced directly in controller route parameters or return signatures, Swagger omits them from the OpenAPI document. Use `@ApiExtraModels()` to force inspection.

### Polymorphic Union Types (`oneOf`)

Consider a domain where an endpoint accepts either a `CatDto` or a `DogDto`:

```typescript
// apps/api/src/pets/dto/pet.dto.ts
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

export class CatDto {
  @ApiProperty({ example: 'feline' })
  type!: 'feline';

  @ApiProperty()
  lives!: number;
}

export class DogDto {
  @ApiProperty({ example: 'canine' })
  type!: 'canine';

  @ApiProperty()
  barkVolume!: number;
}

@ApiExtraModels(CatDto, DogDto)
export class PetOwnerDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(CatDto) },
      { $ref: getSchemaPath(DogDto) },
    ],
  })
  pet!: CatDto | DogDto;
}
```

> [!NOTE]
> `getSchemaPath()` returns the canonical OpenAPI JSON Pointer string (`#/components/schemas/<ModelName>`).

---

## 9. Explicit Schema Naming & Documentation with `@ApiSchema()`

By default, the OpenAPI schema name matches the TypeScript class name. Use `@ApiSchema()` to override the published name or attach a schema description:

```typescript
import { ApiSchema } from '@nestjs/swagger';

@ApiSchema({
  name: 'CreateCatPayload',
  description: 'Validation schema for creating a new registered feline',
})
export class CreateCatDto {
  // ...
}
```

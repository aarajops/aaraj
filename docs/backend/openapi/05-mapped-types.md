# Mapped Types

> **Domain**: Schema Derivation, DRY DTO Transformation & Inheritance  
> **Source Reference**: [NestJS OpenAPI Mapped Types](https://docs.nestjs.com/openapi/mapped-types)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

When engineering CRUD (Create/Read/Update/Delete) resources, creating multiple variations of the same base model (e.g. creating, updating, patching, response projection) frequently leads to copy-paste duplication. 

NestJS provides mapped type utilities that dynamically construct derived TypeScript classes while preserving and updating OpenAPI schema metadata.

---

## 1. The Critical Import Rule

> [!CAUTION]
> **Always Import from `@nestjs/swagger`**: Nest provides mapped types in two separate packages: `@nestjs/mapped-types` and `@nestjs/swagger`. When authoring DTOs intended for OpenAPI documentation, **always import mapped types from `@nestjs/swagger`**. Importing from `@nestjs/mapped-types` erases OpenAPI property annotations and generates empty schemas in Swagger UI.

```typescript
// CORRECT
import { PartialType, PickType, OmitType, IntersectionType } from '@nestjs/swagger';

// INCORRECT (Breaks Swagger UI Schema Generation)
import { PartialType } from '@nestjs/mapped-types';
```

---

## 2. Base Entity / DTO Model

Consider a baseline creation DTO:

```typescript
// apps/api/src/cats/dto/create-cat.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CreateCatDto {
  @ApiProperty({ example: 'Luna' })
  name!: string;

  @ApiProperty({ example: 2 })
  age!: number;

  @ApiProperty({ example: 'Siamese' })
  breed!: string;

  @ApiProperty({ example: 'microchip-12345' })
  microchipId!: string;
}
```

---

## 3. `PartialType()` (Making All Properties Optional)

Used primarily for `PATCH` operations or flexible updates where callers supply only the fields they wish to modify:

```typescript
// apps/api/src/cats/dto/update-cat.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateCatDto } from './create-cat.dto.js';

export class UpdateCatDto extends PartialType(CreateCatDto) {}
```

The resulting `UpdateCatDto` inherits all four properties (`name`, `age`, `breed`, `microchipId`), but sets every property's OpenAPI `required` flag to `false`.

---

## 4. `PickType()` (Selecting a Subset of Properties)

Constructs a new class containing only the explicitly selected keys:

```typescript
// apps/api/src/cats/dto/update-cat-age.dto.ts
import { PickType } from '@nestjs/swagger';
import { CreateCatDto } from './create-cat.dto.js';

export class UpdateCatAgeDto extends PickType(CreateCatDto, ['age'] as const) {}
```

> [!IMPORTANT]
> The second argument must be declared with `as const` (e.g. `['age'] as const`) to allow TypeScript to narrow the array elements to literal key types.

---

## 5. `OmitType()` (Excluding Sensitive or System Fields)

Constructs a new class containing all properties *except* those explicitly omitted. Ideal for update payloads that should not allow mutating immutable identifiers:

```typescript
// apps/api/src/cats/dto/update-cat-profile.dto.ts
import { OmitType } from '@nestjs/swagger';
import { CreateCatDto } from './create-cat.dto.js';

// Exclude microchipId from being updated:
export class UpdateCatProfileDto extends OmitType(CreateCatDto, ['microchipId'] as const) {}
```

---

## 6. `IntersectionType()` (Combining Multiple Schemas)

Merges properties from two distinct classes into a single unified type:

```typescript
// apps/api/src/cats/dto/medical-record.dto.ts
import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import { CreateCatDto } from './create-cat.dto.js';

export class MedicalRecordDto {
  @ApiProperty({ example: 'Rabies, FVRCP' })
  vaccinations!: string;

  @ApiProperty({ example: '2026-05-15' })
  lastVetVisit!: string;
}

export class RegisteredCatDetailsDto extends IntersectionType(
  CreateCatDto,
  MedicalRecordDto,
) {}
```

The generated schema for `RegisteredCatDetailsDto` combines all properties from `CreateCatDto` and `MedicalRecordDto`.

---

## 7. Composing Mapped Types

Mapped type functions are fully composable, allowing intricate domain derivations in a single readable line:

```typescript
// apps/api/src/cats/dto/patch-cat-details.dto.ts
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCatDto } from './create-cat.dto.js';

// Create a type where all fields are optional, excluding the immutable microchipId
export class PatchCatDetailsDto extends PartialType(
  OmitType(CreateCatDto, ['microchipId'] as const),
) {}
```

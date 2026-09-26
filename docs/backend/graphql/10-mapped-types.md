# 10 - GraphQL Mapped Types

> **Source Reference**: [NestJS Official Documentation - Mapped Types](https://docs.nestjs.com/graphql/mapped-types)

> [!NOTE]
> Mapped types are an exclusive feature of the **Code First** approach.

Building CRUD applications often requires creating multiple variants of a base entity or input type (e.g. create vs. update DTOs). Rather than duplicating field declarations and validation rules, `@nestjs/graphql` provides composable mapped type utilities.

---

## 1. `PartialType`

`PartialType()` creates a new class with all properties of the input type set to optional (`nullable: true`):

```typescript
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class CreateUserInput {
  @Field()
  email: string;

  @Field()
  firstName: string;

  @Field()
  lastName: string;
}

// All fields become optional in UpdateUserInput
@InputType()
export class UpdateUserInput extends PartialType(CreateUserInput) {}
```

### Changing Target Decorator Type

If the base class is an `@ObjectType()` but the partial variant is an `@InputType()`, pass `InputType` as the second argument:

```typescript
import { Field, ID, InputType, ObjectType, PartialType } from '@nestjs/graphql';

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;
}

// Emits an InputType rather than inheriting ObjectType
@InputType()
export class UpdateUserDto extends PartialType(User, InputType) {}
```

---

## 2. `PickType` & `OmitType`

### `PickType`

Selects an explicit subset of properties from a source class:

```typescript
import { InputType, PickType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input.js';

@InputType()
export class UpdateEmailInput extends PickType(CreateUserInput, ['email'] as const) {}
```

### `OmitType`

Constructs a type containing every property **except** the specified exclusions:

```typescript
import { InputType, OmitType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input.js';

// Includes firstName and lastName, excluding email
@InputType()
export class UpdateProfileInput extends OmitType(CreateUserInput, ['email'] as const) {}
```

---

## 3. `IntersectionType`

Combines two distinct types into a unified class:

```typescript
import { Field, InputType, IntersectionType } from '@nestjs/graphql';

@InputType()
export class BaseIdentityInput {
  @Field()
  username: string;
}

@InputType()
export class ContactInput {
  @Field()
  email: string;
}

@InputType()
export class RegisterUserInput extends IntersectionType(
  BaseIdentityInput,
  ContactInput,
) {}
```

---

## 4. Composition

Mapped types can be chained and nested arbitrarily:

```typescript
import { InputType, OmitType, PartialType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input.js';

// Omits email, and marks all remaining fields optional
@InputType()
export class PatchUserInput extends PartialType(
  OmitType(CreateUserInput, ['email'] as const),
) {}
```

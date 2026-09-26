# 03 - Serialization

> **Source Reference**: [NestJS Official Documentation - Serialization](https://docs.nestjs.com/application/serialization)

Serialization is the process of shaping, transforming, and sanitizing outbound data before it leaves the HTTP server in a response. Sensitive fields—such as password hashes, refresh tokens, MFA secrets, and internal database audit metadata—must be permanently excluded from client payloads.

NestJS provides declarative serialization interceptors that guarantee data protection at the architectural level, preventing accidental data leaks even if an engineer returns a raw database record.

---

## 1. Comparing Serialization Interceptors

NestJS provides two built-in interceptors for response transformation:

| Feature | `StandardSchemaSerializerInterceptor` (Zod / Standard Schema) | `ClassSerializerInterceptor` (`class-transformer`) |
| :--- | :--- | :--- |
| **Declaration** | Standard Schema definition (e.g. Zod) | Class decorated with `@Exclude()`, `@Expose()` |
| **Security Paradigm** | **Strict Allowlist**: Only explicitly declared fields leave the server | **Blocklist**: Properties are exposed by default unless decorated with `@Exclude()` |
| **Data Transformation** | Native `.transform()` methods | `@Transform(({ value }) => ...)` decorators |
| **Object Type Requirement** | Works with any plain object, Prisma model, or class instance | Requires an instantiated class (`new UserEntity()`) or `@SerializeOptions({ type })` |
| **Error Handling** | Throws `500 Internal Server Error` if data fails the schema (catches bugs early) | Silently drops or coerces unmapped fields |

> **Critical Security Advantage**: `StandardSchemaSerializerInterceptor` uses an **allowlist by default**. If a developer adds a new sensitive column (e.g. `totpSecret`) to a database table, it will **never** be sent to the client unless someone explicitly edits the outbound response schema.

---

## 2. Schema-Based Serialization with Zod

### Defining Response Schemas

Define response contracts in `packages/contracts`:

```typescript
// packages/contracts/src/users/user-response.schema.ts
import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.date().or(z.string()),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
```

Notice that `passwordHash`, `resetToken`, and `internalId` are completely absent from `userResponseSchema`. Because `z.object()` strips undeclared keys, those sensitive fields will be eliminated from the HTTP response.

### Binding the Interceptor & Schema to a Controller

```typescript
// apps/api/src/users/users.controller.ts
import {
  Controller,
  Get,
  Param,
  UseInterceptors,
  SerializeOptions,
} from '@nestjs/common';
import { StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { userResponseSchema, type UserResponse } from '@araz/contracts';
import { UsersService } from './users.service.js';

@Controller('users')
@UseInterceptors(StandardSchemaSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  @SerializeOptions({ schema: userResponseSchema })
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    // Service returns complete DB entity containing passwordHash
    const user = await this.usersService.findById(id);
    return user; 
    // Response sent to client: Only id, email, firstName, lastName, avatarUrl, createdAt!
  }

  @Get()
  @SerializeOptions({ schema: userResponseSchema })
  async findAll(): Promise<UserResponse[]> {
    // When returning an array, pass the SINGLE-ITEM schema
    // The interceptor automatically applies it to every array element
    return this.usersService.findAll();
  }
}
```

---

## 3. Schema Transformations & Computed Fields

Schemas can compute new attributes, format dates, and reshape nested objects cleanly using `.transform()`:

```typescript
import { z } from 'zod';

export const userProfileSchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.object({
      id: z.number(),
      name: z.string(),
    }),
    createdAt: z.date(),
  })
  .transform((user) => ({
    id: user.id,
    fullName: `${user.firstName} ${user.lastName}`,
    role: user.role.name, // Flattens nested object to scalar string
    memberSince: user.createdAt.toISOString(),
  }));
```

Given an internal database record:
```json
{
  "id": "c1a6b052-16a7-4c40-a352-8bbdca780f2d",
  "firstName": "Alex",
  "lastName": "Rivera",
  "role": { "id": 1, "name": "ADMIN" },
  "createdAt": "2026-01-15T08:00:00.000Z",
  "passwordHash": "$2b$12$e..."
}
```

The client receives:
```json
{
  "id": "c1a6b052-16a7-4c40-a352-8bbdca780f2d",
  "fullName": "Alex Rivera",
  "role": "ADMIN",
  "memberSince": "2026-01-15T08:00:00.000Z"
}
```

---

## 4. Application-Wide Global Serialization

To apply `StandardSchemaSerializerInterceptor` globally across all controllers, register it with `APP_INTERCEPTOR` or attach it via `Reflector`:

### Preferred: Multi-Provider via `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { StandardSchemaSerializerInterceptor } from '@nestjs/common';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: StandardSchemaSerializerInterceptor,
    },
  ],
})
export class AppModule {}
```

Routes that omit `@SerializeOptions({ schema })` are passed through untouched without modification.

---

## 5. Serialization Error Behavior

A serialization error represents a **server-side bug**, not a client validation error. If a handler returns data that does not satisfy its declared `@SerializeOptions({ schema })` (e.g. a required field is `undefined`), the interceptor throws an internal error resulting in:

```text
HTTP 500 Internal Server Error
```

This prevents malformed or partially serialized data from ever reaching the public client, and alerts monitoring systems immediately.

---

## 6. Legacy `ClassSerializerInterceptor` Reference

If interacting with systems that rely on `class-transformer`:

```typescript
import { Exclude, Expose, Transform } from 'class-transformer';

export class UserEntity {
  id!: number;
  firstName!: string;
  lastName!: string;

  @Exclude()
  password!: string;

  @Expose()
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  @Transform(({ value }) => value.toISOString())
  createdAt!: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
```

```typescript
@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  @Get(':id')
  @SerializeOptions({ type: UserEntity }) // Automatically converts plain object to UserEntity
  findOne() {
    return { id: 1, firstName: 'Jane', lastName: 'Doe', password: 'secret' };
  }
}
```

> **Note on Streaming Responses**: Neither `StandardSchemaSerializerInterceptor` nor `ClassSerializerInterceptor` serializes `StreamableFile` responses. Streams bypass interceptor transformation directly to the HTTP socket.

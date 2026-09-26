# CRUD Generator Schematics

> **Domain**: Rapid Application Development, Schematic Code Generation & Transport Modeling  
> **Source Reference**: [NestJS CRUD Generator Recipe](https://docs.nestjs.com/recipes/crud-generator)  
> **Package**: `@nestjs/schematics`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Building enterprise applications requires repeatedly scaffolding standard domain resources. Creating an entity usually involves boilerplate steps: generating a module, a controller/resolver/gateway, a service, entity classes, and input/output Data Transfer Objects (DTOs).

The Nest CLI provides the `resource` generator to automate this entire workflow across multiple transport layers with a single command.

---

## 1. Invoking the Resource Generator

To generate a new resource, execute `nest g resource` from your terminal:

```bash
# Interactive prompt
nest g resource users

# Non-interactive CLI flags for CI/CD or automation
nest g resource orders --type rest --crud true --no-spec
```

During interactive execution, the CLI prompts for two architectural decisions:
1. **Transport Layer Selection**:
   - `REST API`
   - `GraphQL (code first)`
   - `GraphQL (schema first)`
   - `Microservice` (Message / Event handlers)
   - `WebSockets` (Gateways)
2. **Generate CRUD entry points?** (`Yes` / `No`)

---

## 2. Generated File Architecture

When generating a REST resource (`users`), the schematic outputs the following cohesive file structure:

```text
src/users/
├── dto/
│   ├── create-user.dto.ts       <-- Inbound creation payload validation
│   └── update-user.dto.ts       <-- Update payload (extends PartialType)
├── entities/
│   └── user.entity.ts           <-- Domain entity representation
├── users.controller.spec.ts     <-- Controller unit tests (omitted if --no-spec)
├── users.controller.ts          <-- REST endpoint handlers (POST, GET, PATCH, DELETE)
├── users.module.ts              <-- Module registering controller and provider
├── users.service.spec.ts        <-- Service unit tests
└── users.service.ts             <-- Business logic layer (ORM-agnostic)
```

---

## 3. Generated Code Samples

### 1. REST API Controller (`src/users/users.controller.ts`)

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
```

### 2. GraphQL Code-First Resolver (`src/users/users.resolver.ts`)

When choosing `GraphQL (code first)`, the schematic generates a strongly typed resolver:

```typescript
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UsersService } from './users.service.js';
import { User } from './entities/user.entity.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';

@Resolver(() => User)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Mutation(() => User)
  createUser(@Args('createUserInput') createUserInput: CreateUserInput) {
    return this.usersService.create(createUserInput);
  }

  @Query(() => [User], { name: 'users' })
  findAll() {
    return this.usersService.findAll();
  }

  @Query(() => User, { name: 'user' })
  findOne(@Args('id', { type: () => Int }) id: number) {
    return this.usersService.findOne(id);
  }

  @Mutation(() => User)
  updateUser(@Args('updateUserInput') updateUserInput: UpdateUserInput) {
    return this.usersService.update(updateUserInput.id, updateUserInput);
  }

  @Mutation(() => User)
  removeUser(@Args('id', { type: () => Int }) id: number) {
    return this.usersService.remove(id);
  }
}
```

---

## 4. ORM Agnosticism & Enterprise Integration

The generated `UsersService` is intentionally database-agnostic. The methods return placeholder strings or mock objects (`This action returns all users`), allowing you to inject your persistence tool of choice (e.g. Drizzle, TypeORM, Prisma, or Mongo repositories) without fighting pre-configured database assumptions:

```typescript
// apps/api/src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
```

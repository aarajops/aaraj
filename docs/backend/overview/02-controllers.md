# 02 - Controllers

> **Source Reference**: [NestJS Official Documentation - Controllers](https://docs.nestjs.com/controllers)

Controllers are responsible for handling incoming HTTP requests and returning responses to the client. A controller's primary purpose is to receive specific requests for the application, parse and validate the incoming payloads, and delegate business processing to providers (services).

---

## 1. Defining a Controller

A basic controller is defined using the `@Controller()` decorator, which accepts an optional route path prefix:

```typescript
import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async findAll() {
    return this.appService.getUsers();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.appService.getUserById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED) // 201 Created (Default for POST)
  async create(@Body() createUserDto: unknown) {
    return this.appService.createUser(createUserDto);
  }
}
```

---

## 2. HTTP Method Decorators

Nest provides standard decorators corresponding to HTTP verbs:

| Decorator | HTTP Method | Default Status Code |
| :--- | :--- | :--- |
| `@Get()` | `GET` | `200 OK` |
| `@Post()` | `POST` | `201 Created` |
| `@Put()` | `PUT` | `200 OK` |
| `@Delete()` | `DELETE` | `200 OK` |
| `@Patch()` | `PATCH` | `200 OK` |
| `@Options()`| `OPTIONS` | `200 OK` |
| `@Head()` | `HEAD` | `200 OK` |
| `@All()` | Any method | Matches verb |

To explicitly override the default status code, use the `@HttpCode()` decorator:

```typescript
import { HttpCode, HttpStatus, Delete } from '@nestjs/common';

@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT) // 204 No Content
async remove(@Param('id') id: string): Promise<void> {
  await this.usersService.delete(id);
}
```

---

## 3. Request Payloads & Parameter Decorators

Nest provides declarative decorators that extract data directly from the underlying HTTP request:

| Decorator | Underlying Object / Equivalent | Example Usage |
| :--- | :--- | :--- |
| `@Param(key?: string)` | `req.params` or `req.params[key]` | `@Param('id') id: string` |
| `@Query(key?: string)` | `req.query` or `req.query[key]` | `@Query('page') page: string` |
| `@Body(key?: string)` | `req.body` or `req.body[key]` | `@Body() createDto: CreateDto` |
| `@Headers(name?: string)`| `req.headers` or `req.headers[name]` | `@Headers('authorization') auth: string` |
| `@Ip()` | `req.ip` | `@Ip() clientIp: string` |
| `@Req()` | `req` (Underlying platform request) | `@Req() req: Request` |
| `@Res()` | `res` (Underlying platform response) | `@Res({ passthrough: true }) res: Response` |

> **Warning on `@Res()`**: If you inject `@Res()`, Nest enters *library-specific mode* and disables automatic JSON serialization and response interceptors. Always use `@Res({ passthrough: true })` if you only need to set custom headers or cookies while retaining Nest's declarative response handling.

---

## 4. Response Handling: Declarative vs. Library-Specific

Nest provides two approaches for manipulating responses:

1. **Standard (Declarative - Strongly Recommended)**:
   Returning a JavaScript object, array, or primitive automatically serializes it to JSON (or plain text for strings).
   ```typescript
   @Get()
   findAll(): UserResponse[] {
     return this.usersService.findAll();
   }
   ```

2. **Library-Specific (Manual)**:
   Directly accessing Express or Fastify response objects. Use this only when streaming files or setting vendor-specific cookies:
   ```typescript
   import type { Response } from 'express';

   @Get('download')
   downloadReport(@Res() res: Response) {
     res.download('/path/to/report.pdf');
   }
   ```

---

## 5. Headers & Redirects

### Custom Response Headers
```typescript
import { Header } from '@nestjs/common';

@Get('export')
@Header('Content-Type', 'text/csv')
@Header('Content-Disposition', 'attachment; filename="export.csv"')
exportData() {
  return 'id,name,role\n1,Admin,Superuser';
}
```

### Dynamic & Static Redirection
```typescript
import { Redirect } from '@nestjs/common';

// Static redirect
@Get('legacy-docs')
@Redirect('https://docs.nestjs.com', 301)
redirectToDocs() {}

// Dynamic redirect
@Get('docs')
@Redirect('https://docs.nestjs.com', 302)
dynamicDocsRedirect(@Query('version') version?: string) {
  if (version === 'v1') {
    return { url: 'https://v1.nestjs.com', statusCode: 301 };
  }
}
```

---

## 6. Sub-Domain Routing

The `@Controller()` decorator can match requests based on HTTP `Host` headers:

```typescript
@Controller({ host: ':account.aaraj.com' })
export class AccountController {
  @Get()
  getInfo(@HostParam('account') account: string) {
    return { tenant: account };
  }
}
```

---

## 7. Asynchronous Handlers: Promises & Observables

Every route handler can be asynchronous, returning either a standard JavaScript `Promise` or an RxJS `Observable`:

```typescript
import { Observable, of } from 'rxjs';

// Promise (Standard)
@Get('async')
async findAsync(): Promise<string[]> {
  return await this.service.fetchData();
}

// Observable (RxJS)
@Get('stream')
findStream(): Observable<string[]> {
  return of(['item1', 'item2']);
}
```

Nest automatically subscribes to returned Observables and sends the emitted value upon completion.

---

## 8. Best Practices for Controllers

1. **Keep Controllers Thin**: Controllers should only handle routing, protocol-level translation (HTTP status codes, headers), and input validation. Business rules, database operations, and external API calls belong in **Providers**.
2. **Contract-Driven DTOs**: Never accept arbitrary `any` payloads. Pair body arguments with validated schemas (e.g. from `@aaraj/contracts`).
3. **Avoid Stateful Controllers**: Controllers are singletons by default. Do not store request-specific state in controller class properties.

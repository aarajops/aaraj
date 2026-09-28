# 12 - Testing

> **Source Reference**: [NestJS Official Documentation - Testing](https://docs.nestjs.com/fundamentals/testing)

Automated testing is vital for enterprise applications. NestJS provides dedicated testing utilities (`@nestjs/testing`) that replicate the runtime Inversion of Control (IoC) container, allowing you to mock dependencies, override providers, and execute end-to-end integration tests with zero boilerplate.

In the `@aaraj` monorepo, both unit and end-to-end test suites run on **Vitest** for native ECMAScript Modules (ESM) support and extreme execution speed.

---

## 1. Unit Testing with Vitest

### 1. Isolated Unit Testing
For simple classes without complex dependencies, instantiate the class directly with Vitest test doubles (`vi.fn()`, `vi.spyOn()`):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController (Isolated)', () => {
  let controller: UsersController;
  let service: UsersService;

  beforeEach(() => {
    service = new UsersService();
    controller = new UsersController(service);
  });

  it('should return all users', async () => {
    const mockUsers = [{ id: '1', name: 'Alice' }];
    vi.spyOn(service, 'findAll').mockImplementation(() => mockUsers as any);

    expect(controller.findAll()).toBe(mockUsers);
  });
});
```

---

### 2. Testing with `Test.createTestingModule()`

When testing classes that rely on Nest's dependency injection:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController (IoC Test)', () => {
  let controller: UsersController;
  let service: UsersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: vi.fn().mockReturnValue([{ id: '1', name: 'Alice' }]),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(UsersController);
    service = moduleRef.get(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });
});
```

---

## 2. Auto-Mocking with `useMocker()`

When testing a component with numerous dependencies, creating individual mock providers is tedious. Use `useMocker()` to generate mocks automatically for all unspecified providers:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('UsersController (Auto-Mocking)', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
    })
      .useMocker((token) => {
        if (token === UsersService) {
          return {
            findAll: vi.fn().mockResolvedValue(['User1', 'User2']),
          };
        }
      })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  it('resolves auto-mocked service', async () => {
    expect(controller).toBeDefined();
  });
});
```

---

## 3. End-to-End (E2E) Testing with Supertest

End-to-End tests verify the entire request pipeline: HTTP routing, middleware, guards, pipes, controllers, and exception filters:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

describe('API Endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    
    // Apply exact same global configuration as production main.ts
    configureApp(app);
    
    await app.init();
  });

  it('GET /api/health returns 200 OK with valid schema', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      service: 'api',
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

---

## 4. Overriding Globally Registered Enhancers

When a guard or interceptor is registered globally using multi-provider tokens (`APP_GUARD`, `APP_INTERCEPTOR`), overriding it requires the `useExisting` pattern in the module definition:

```typescript
// app.module.ts
@Module({
  providers: [
    JwtAuthGuard,
    {
      provide: APP_GUARD,
      useExisting: JwtAuthGuard, // Allows overriding JwtAuthGuard directly!
    },
  ],
})
export class AppModule {}
```

### Overriding in E2E Test
```typescript
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(JwtAuthGuard)
  .useValue({ canActivate: () => true }) // Bypass authentication for test
  .compile();
```

---

## 5. Testing Request-Scoped Instances

Request-scoped providers are instantiated per request and cannot be retrieved with `moduleRef.get()`. To test them, force Nest to use a known `ContextId`:

```typescript
import { ContextIdFactory } from '@nestjs/core';
import { vi } from 'vitest';

const contextId = ContextIdFactory.create();
vi.spyOn(ContextIdFactory, 'getByRequest').mockImplementation(() => contextId);

// Resolve the exact request-scoped instance
const scopedService = await moduleRef.resolve(RequestScopedService, contextId);
```

# Common Errors & Dependency Injection Troubleshooting

> **Domain**: Diagnostics, Error Fingerprinting & Dependency Graph Resolution  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

During the development and maintenance of large-scale NestJS applications, subtle architectural mistakes can trigger obscure runtime errors during application bootstrap. This guide provides diagnostic playbooks for resolving the most frequent NestJS compilation and runtime failures.

---

## 1. "Cannot Resolve Dependency" Error

The most frequent bootstrap exception indicates that the NestJS IoC container cannot resolve an argument requested in a class constructor:

```text
Nest can't resolve dependencies of the OrderService (?). Please make sure that the argument PaymentService at index [0] is available in the OrderModule context.
```

### Diagnostic Checklist

1. **Missing Module Export**: If `PaymentService` is defined in `PaymentModule`, make sure `PaymentService` is listed in the `exports` array of `PaymentModule`, AND that `PaymentModule` is listed in the `imports` array of `OrderModule`.
2. **Provider in Imports Array**: Placing an `@Injectable()` service inside `@Module({ imports: [PaymentService] })` instead of `providers: []` causes an immediate compilation crash.
3. **Self-Injection**: Injecting a service into its own constructor (`constructor(private self: OrderService)`).

---

## 2. Undefined Dependency at Index `[X]`

When the error message reports:
```text
Nest can't resolve dependencies of the OrderService (?). Please make sure that the argument at index [0] is available in the OrderModule context.
```
Without naming the token, the value at runtime evaluated to `undefined`. This is caused by one of three common issues:

### Cause A: Type-Only Imports (`import type`)
In TypeScript, `import type` erases the imported symbol during compilation:

```typescript
// BROKEN: Prevents reflect-metadata from emitting constructor types
import type { PaymentService } from './payment.service.js';

@Injectable()
export class OrderService {
  constructor(private readonly payment: PaymentService) {} // Emitted as Object/undefined
}

// CORRECT: Emit concrete class reference for runtime reflection
import { PaymentService } from './payment.service.js';

@Injectable()
export class OrderService {
  constructor(private readonly payment: PaymentService) {}
}
```

### Cause B: Injecting TypeScript Interfaces
Interfaces and type aliases are purely compile-time constructs with no runtime footprint. When injecting an interface, bind it to an explicit token using `@Inject()`:

```typescript
// BROKEN
constructor(private readonly repo: IUserRepository) {}

// CORRECT
constructor(@Inject(USER_REPOSITORY_TOKEN) private readonly repo: IUserRepository) {}
```

### Cause C: Circular Barrel Imports
Two files importing constants or providers from each other through an index barrel file (`index.ts`) can result in a circular file evaluation where one symbol is `undefined` at parse time. Always import directly from the source module file in ESM (`./auth.constants.js`).

---

## 3. Circular Dependency Errors & `forwardRef()`

When two modules or providers depend on each other:

```text
Nest cannot create the OrderModule instance.
The module at index [0] of the OrderModule "imports" array is undefined.
```

### Solution: `forwardRef()` on Modules & Providers

Wrap the import in `forwardRef()` on **both** sides of the cycle:

```typescript
// orders.module.ts
@Module({
  imports: [forwardRef(() => BillingModule)],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

// billing.module.ts
@Module({
  imports: [forwardRef(() => OrdersModule)],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
```

And in the corresponding services:

```typescript
// orders.service.ts
@Injectable()
export class OrdersService {
  constructor(
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}
}
```

---

## 4. Monorepo Duplicate `@nestjs/core` Resolution

In pnpm or Yarn workspaces, if a local library or package bundles an internal copy of `@nestjs/core`, the runtime loads two distinct copies of the container, triggering:
```text
Please make sure that the argument ModuleRef at index [0] is available in the AppModule context.
```

### Solution for pnpm Workspaces
In the consumer package (`apps/api/package.json`), configure `dependenciesMeta`:

```json
{
  "dependencies": {
    "@aaraj/contracts": "workspace:*"
  },
  "dependenciesMeta": {
    "@aaraj/contracts": {
      "injected": true
    }
  }
}
```

Ensure `@nestjs/core` and `@nestjs/common` are declared as `peerDependencies` in shared workspace packages rather than direct `dependencies`.

---

## 5. Tracing Dependency Resolution with `NEST_DEBUG`

To print the complete dependency injection graph as it is being resolved during bootstrap, start the process with the `NEST_DEBUG` environment variable:

```bash
NEST_DEBUG=true pnpm start
```

The output will display the exact host class (yellow), the requested token (blue), and the evaluating module (purple), allowing you to pinpoint where an unprovided dependency is introduced.

---

## 6. Endless "File Change Detected" Loops in Watch Mode

On Windows workstations running TypeScript 4.9+, file system events can cause an infinite loop in watch mode:

```bash
File change detected. Starting incremental compilation...
Found 0 errors. Watching for file changes.
```

### Fix: Polling Strategy in `tsconfig.json`

Add `watchOptions` to your `tsconfig.json`:

```json
{
  "compilerOptions": { ... },
  "watchOptions": {
    "watchFile": "fixedPollingInterval"
  }
}
```

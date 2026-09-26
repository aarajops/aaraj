# SWC (Fast Compiler)

> **Domain**: Rust Compilation Toolchains, Developer Ergonomics & Build Speed  
> **Source Reference**: [NestJS SWC Recipe](https://docs.nestjs.com/recipes/swc)  
> **Package**: `@swc/core` | `@swc/cli` | `unplugin-swc`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

[SWC](https://swc.rs/) (Speedy Web Compiler) is an extensible, Rust-based platform for compilation and bundling. While standard TypeScript compilation (`tsc`) can become slow as application graphs expand, SWC delivers compilation speeds approximately **20 times faster** than the default TypeScript compiler.

---

## 1. Installation & Basic Configuration

Install the required SWC compiler dependencies:

```bash
pnpm add -D @swc/cli @swc/core
```

### Running with the Nest CLI

Instruct the Nest CLI to use the `swc` builder:

```bash
# Run once using SWC
nest start -b swc

# Run in live watch mode with SWC
nest start -b swc -w
```

### Permanent Configuration in `nest-cli.json`

Set the builder directly in `nest-cli.json` so that all build and start commands use SWC automatically:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "builder": {
      "type": "swc",
      "options": {
        "swcrcPath": ".swcrc"
      }
    },
    "typeCheck": true
  }
}
```

---

## 2. Asynchronous Type Checking

Unlike `tsc`, SWC focuses exclusively on AST transpilation and **does not perform type checking**. To prevent type regressions while maintaining ultra-fast rebuilds, enable the `--type-check` flag:

```bash
nest start -b swc --type-check
```

This flag instructs the Nest CLI to run `tsc` in asynchronous `noEmit` mode in parallel with SWC transpilation. Type validation errors are reported without blocking application startup.

---

## 3. Configuration via `.swcrc`

SWC can be customized using a root `.swcrc` configuration file:

```json
{
  "$schema": "https://swc.rs/schema.json",
  "sourceMaps": true,
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true,
      "dynamicImport": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    },
    "baseUrl": "./"
  },
  "minify": false
}
```

> [!NOTE]
> When your `package.json` specifies `"type": "module"`, the SWC builder automatically emits ECMAScript Modules (ESM).

---

## 4. Circular Dependency Pitfall & `Relation<T>` Workaround

SWC processes files in isolation and does not handle circular TypeScript type imports well when generating decorator metadata. This frequently causes runtime crashes with ORM entities (such as TypeORM or MikroORM) or circular service injections.

### 1. ORM Entity Relations

In entity definitions, wrap circular target classes in `Relation<T>`:

```typescript
// apps/api/src/users/entities/user.entity.ts
import { Entity, OneToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { Profile } from './profile.entity.js';

@Entity()
export class User {
  @OneToOne(() => Profile, (profile) => profile.user)
  profile!: Relation<Profile>; // Prevents SWC from emitting circular metadata
}
```

### 2. General Service Injection Workaround

If an ORM does not provide `Relation<T>`, or when injecting circular services with `forwardRef()`, define an identity wrapper type:

```typescript
export type WrapperType<T> = T;

@Injectable()
export class UsersService {
  constructor(
    @Inject(forwardRef(() => ProfileService))
    private readonly profileService: WrapperType<ProfileService>,
  ) {}
}
```

---

## 5. Vitest + SWC Setup (Production Recommendation)

Modern NestJS 12 ESM applications use [Vitest](https://vitest.dev/) configured with `unplugin-swc` for instant unit and integration testing:

```bash
pnpm add -D vitest unplugin-swc @swc/core @vitest/coverage-v8
```

### Root Unit Test Config (`vitest.config.ts`)

```typescript
// vitest.config.ts
import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      src: resolve(import.meta.dirname, './src'),
    },
  },
});
```

### End-to-End Test Config (`vitest.config.e2e.ts`)

```typescript
// vitest.config.e2e.ts
import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.e2e-spec.ts'],
    globals: true,
    root: './',
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      src: resolve(import.meta.dirname, './src'),
    },
  },
});
```

> [!IMPORTANT]
> **Supertest Default Import in ESM**: In an ES module environment with Vitest, `supertest` must be imported as a default import:
> ```typescript
> // CORRECT in ESM:
> import request from 'supertest';
>
> // INCORRECT (Fails with "request is not a function"):
> import * as request from 'supertest';
> ```

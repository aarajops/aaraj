# Monorepo Libraries Architecture

> **Domain**: Reusable Component Modularization, Path Mapping & Compilation Bundling  
> **Source Reference**: [NestJS Libraries Documentation](https://docs.nestjs.com/cli/libraries)  
> **Directory Root**: `libs/`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

As backend applications expand into distributed microservices or multi-tenant platforms, domain boundaries naturally emerge. Cross-cutting concerns—such as database connectivity, authentication strategies, encryption utilities, logging interceptors, and shared data transfer objects (DTOs)—must be shared without duplication.

Nest monorepo **libraries** provide a first-class, lightweight abstraction for code reuse within a workspace. Unlike external npm packages, monorepo libraries require no publishing pipeline, version synchronization, or local link workflows (`npm link` / `pnpm link`). Consumers in the workspace immediately consume the latest source updates.

---

## 1. Monorepo Libraries vs. External NPM Packages

| Dimension | Monorepo Library (`libs/`) | External NPM Package |
| :--- | :--- | :--- |
| **Publishing Overhead** | None; compiled directly with the consuming application. | Requires build, semver tagging, registry upload, and token management. |
| **Change Propagation** | Instantaneous across all applications in the workspace. | Consuming applications must bump `package.json` and reinstall. |
| **Integration Testing** | Unified end-to-end tests run across applications and libraries in CI. | Testing requires test registries or cross-repository pipelines. |
| **Path Resolution** | Managed via TypeScript path aliases (`@app/*`). | Managed via `node_modules` package resolution. |
| **Use Case Fit** | Internal domain models, shared core modules, common infrastructure. | Public open-source tools, vendor SDKs, cross-enterprise utilities. |

---

## 2. Generating a Monorepo Library

To create a new library, run `nest generate library <name>` (or the alias `nest g lib <name>`):

```bash
nest generate library shared-database
```

During execution, the CLI prompts for a path alias prefix:

```text
What prefix would you like to use for the library (default: @app or 'defaultLibraryPrefix' setting value)?
```

Pressing **Enter** assigns the default prefix `@app`. To customize the default prefix workspace-wide, define `"defaultLibraryPrefix": "@my-org"` in your `nest-cli.json`.

### Generated Directory Hierarchy

The command scaffolds the library into a new `libs/` folder at the workspace root:

```text
libs/
└── shared-database/
    ├── src/
    │   ├── index.ts                     <-- Public API export barrel
    │   ├── shared-database.module.ts    <-- Reusable NestJS module
    │   └── shared-database.service.ts   <-- Core provider
    ├── tsconfig.lib.json                <-- Compiler options extending root tsconfig
```

---

## 3. Configuration & Path Mapping

### `nest-cli.json` Project Registration

The schematic automatically registers the library under `"projects"`:

```json
{
  "projects": {
    "shared-database": {
      "type": "library",
      "root": "libs/shared-database",
      "entryFile": "index",
      "sourceRoot": "libs/shared-database/src",
      "compilerOptions": {
        "tsConfigPath": "libs/shared-database/tsconfig.lib.json"
      }
    }
  }
}
```

Key differences between application and library metadata:
- `"type"`: Set to `"library"` (rather than `"application"`).
- `"entryFile"`: Set to `"index"` (rather than `"main"`), pointing to `src/index.ts`.

### `tsconfig.json` Path Aliases

Nest registers path mappings in the root `tsconfig.json` to allow clean, bare-specifier imports without relative directory backtracking (`../../libs/...`):

```json
{
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@app/shared-database": [
        "./libs/shared-database/src/index.ts"
      ],
      "@app/shared-database/*": [
        "./libs/shared-database/src/*"
      ]
    }
  }
}
```

> [!NOTE]
> In ECMAScript Modules (ESM) projects, the root alias maps directly to the entry barrel file `./libs/shared-database/src/index.ts` to satisfy strict ESM module specifier resolution.

---

## 4. Authoring and Consuming Libraries

### Defining the Public API in `libs/shared-database/src/index.ts`

The library exports its public tokens, modules, and interfaces through `index.ts`:

```typescript
// libs/shared-database/src/index.ts
export * from './shared-database.module.js';
export * from './shared-database.service.js';
```

### Library Module Implementation

```typescript
// libs/shared-database/src/shared-database.module.ts
import { Module } from '@nestjs/common';
import { SharedDatabaseService } from './shared-database.service.js';

@Module({
  providers: [SharedDatabaseService],
  exports: [SharedDatabaseService],
})
export class SharedDatabaseModule {}
```

```typescript
// libs/shared-database/src/shared-database.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SharedDatabaseService {
  private readonly logger = new Logger(SharedDatabaseService.name);

  public checkHealth(): { status: string } {
    this.logger.debug('Validating database cluster connectivity');
    return { status: 'healthy' };
  }
}
```

### Consuming in an Application (`apps/api/src/app.module.ts`)

Applications import the library directly using the registered `@app/*` alias:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@app/shared-database';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [SharedDatabaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

## 5. Test Runner Resolution & Configuration Gotchas

> [!WARNING]
> **TypeScript `paths` are Compile-Time Only**: TypeScript's `paths` mappings inform `tsc` and the type-checker where files exist, but **they are not resolved by Node.js or test runners at runtime**. If you execute integration or e2e tests without configuring your test runner, tests will crash with `Cannot find module '@app/shared-database'`.

### Vitest Configuration (`vitest.config.ts`)

In modern NestJS 12 ESM projects using Vitest, use `vite-tsconfig-paths` or configure aliases explicitly:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
  },
});
```

### Jest Configuration (`jest.config.ts`)

For CommonJS projects utilizing Jest, mirror the path alias in `moduleNameMapper`:

```typescript
// apps/api/test/jest-e2e.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@app/shared-database(|/.*)$": "<rootDir>/../../../libs/shared-database/src/$1"
  }
}
```

---

## 6. Compilation & Bundling Behavior

When building applications in monorepo mode, the default compiler is **Rspack**:

```bash
# Builds the default project along with all consumed libraries
nest build

# Builds a specific application
nest build api

# Compiles an individual library into its standalone output folder
nest build shared-database
```

### Bundling Pipeline

When building an application (e.g., `nest build api`), Rspack traces the application's import graph through `@app/shared-database`, resolves the source files under `libs/shared-database/src/`, and bundles the application and its internal library dependencies into a single output file under `dist/apps/api/main.js`. 

This eliminates the need for complex multi-package build orchestrators for internal code and guarantees high-performance container deployment artifacts.

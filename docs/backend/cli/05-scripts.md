# Scripts & Compiler Toolchains

> **Domain**: Build Pipeline Automation, Local Parity & Compiler Backends  
> **Source Reference**: [NestJS Scripts Documentation](https://docs.nestjs.com/cli/scripts)  
> **Package Management**: `pnpm` | `package.json`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Every NestJS application is a standard TypeScript project that compiles into JavaScript before runtime execution. While teams can customize their build and execution pipelines with custom tools, the Nest CLI provides standard, high-performance defaults that keep pipelines open and extensible.

This guide details how the `nest` command coordinates with package managers (`pnpm`, `npm`), project-local scripts, and compiler backends (`tsc`, `swc`, `rspack`).

---

## 1. The `nest` Binary Resolution & Local Parity

The `nest` CLI covers three architectural responsibilities:
1. **Compilation (`nest build`)**: Wraps the underlying compiler/bundler (`tsc`, `swc`, or `rspack`), runs AST plugins, and copies declared static assets.
2. **Execution (`nest start`)**: Verifies build artifacts and executes the compiled application via `node` with optional debuggers and watch loops.
3. **Generation (`nest generate` / `nest new`)**: Drives code scaffolding schematics.

### Enforcing Team-Wide Version Parity

When `@nestjs/cli` is installed globally (`npm i -g @nestjs/cli`), the OS resolves whatever binary version is in the user's global path. If Developer A runs v11.3 and Developer B runs v12.0, build artifacts and schematic outputs can diverge.

> [!IMPORTANT]
> **Production Best Practice**: Always install `@nestjs/cli` as a `devDependency` in `package.json` and invoke commands through package scripts or local package executors (`pnpm nest` or `pnpm dlx`). This guarantees that every engineer, local container, and CI/CD pipeline runs the exact same compiler logic.

```bash
# Add @nestjs/cli as a project development dependency
pnpm add -D @nestjs/cli
```

---

## 2. Standard `package.json` Script Suite

A production NestJS project defines standard scripts to manage the complete lifecycle:

```json
{
  "name": "my-enterprise-api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "build:swc": "nest build --builder swc --type-check",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:swc": "nest start --builder swc --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/src/main.js",
    "lint": "oxlint --deny-warnings",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

### Execution Lifecycle

- **Development (`pnpm run start:dev`)**: The CLI monitors source files, initiates incremental rebuilds on save, and automatically restarts the application process.
- **Production Build (`pnpm run build`)**: The CLI executes a clean compilation pass, runs registered AST plugins (such as OpenAPI Swagger decorators), copies assets, and produces artifacts in `dist/`.
- **Production Execution (`pnpm run start:prod`)**: Directly runs `node dist/src/main.js` without any CLI or compiler overhead.

---

## 3. Compiler Engines Deep Dive

Nest supports three distinct compilation and bundling engines via `compilerOptions.builder` in `nest-cli.json` or the `--builder` command-line flag.

```text
                        NEST COMPILER PIPELINE OPTIONS
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
        │     tsc      │       │     swc      │       │    rspack    │
        ├──────────────┤       ├──────────────┤       ├──────────────┤
        │ • Official TS│       │ • Rust JIT   │       │ • Rust Pack  │
        │ • 1x Speed   │       │ • ~10x Speed │       │ • Monorepo   │
        │ • Full Types │       │ • No Type-Chk│       │ • 1 Bundle   │
        └──────────────┘       └──────────────┘       └──────────────┘
```

### 1. `tsc` (TypeScript Standard Compiler)

The default compiler for standard mode applications.
- **How it works**: Invokes the official `typescript` compiler API.
- **Pros**: 100% specification compliance; full compile-time type-checking; supports declaration files (`.d.ts`) natively; supports `manualRestart` (`rs` key).
- **Cons**: Slower compilation times for medium-to-large codebases.

### 2. `swc` (Speed-Optimized Transpilation)

A Rust-based platform designed for ultra-fast compilation.
- **How it works**: Transpiles TypeScript into JavaScript up to **10x faster** than `tsc`.
- **Configuration**:
  ```json
  // nest-cli.json
  {
    "compilerOptions": {
      "builder": "swc",
      "typeCheck": true,
      "emitDeclarations": false
    }
  }
  ```
- **Trade-offs**: SWC focuses exclusively on transpilation and ignores type validation by default. To retain type safety, enable `"typeCheck": true` or run `pnpm tsc --noEmit` as part of your CI pipeline.

### 3. `rspack` (High-Performance Bundler)

The default compiler for monorepo workspaces.
- **How it works**: A high-performance, Rust-based bundler compatible with the Webpack API ecosystem.
- **Configuration**:
  ```json
  // nest-cli.json
  {
    "compilerOptions": {
      "builder": "rspack"
    }
  }
  ```
- **Pros**: Resolves cross-project monorepo dependencies into a single consolidated executable bundle; handles massive workspaces with sub-second rebuilds; eliminates complex path-mapping issues at production runtime.

---

## 4. AST Transformation Plugins

Nest CLI build commands automatically apply AST (Abstract Syntax Tree) transformation plugins declared in `nest-cli.json`. These plugins inspect class definitions and automatically generate metadata decorators without manual boilerplate:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true
        }
      }
    ]
  }
}
```

During `nest build`, the plugin automatically annotates DTO properties with `@ApiProperty()` based on TypeScript types and JSDoc comments, keeping API schemas synchronized with zero code duplication.

---

## 5. Migration from Legacy Toolchains

If an existing repository runs legacy tools like `ts-node`, `tsc-watch`, or custom Webpack configurations, migrate to the official Nest CLI toolchain in three steps:

### Step 1: Install `@nestjs/cli` Locally

```bash
pnpm add -D @nestjs/cli
```

### Step 2: Initialize `nest-cli.json`

Create a standard `nest-cli.json` at the root of the project:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "builder": "tsc"
  }
}
```

### Step 3: Replace `package.json` Scripts

Replace legacy commands with standard Nest CLI commands:

```diff
  "scripts": {
-   "build": "tsc -p tsconfig.build.json",
-   "start:dev": "tsc-watch -p tsconfig.build.json --onSuccess \"node dist/main.js\"",
-   "start:debug": "nodemon --config nodemon-debug.json",
+   "build": "nest build",
+   "start:dev": "nest start --watch",
+   "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/src/main.js"
  }
```

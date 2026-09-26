# CLI, Tooling & Compiler Ecosystem Evolution

> **Domain**: Build Engineering, Rspack Monorepos, Vitest & Oxlint Standards  
> **Framework Compatibility**: NestJS v12.x  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

NestJS 12 modernizes the entire development, build, and test toolchain. Webpack is formally deprecated in favor of **Rspack**, **Vitest** replaces Jest as the default test runner for ESM codebases, and **oxlint** provides high-speed Rust-based linting out of the box.

---

## 1. Automated Upgrades with `nest upgrade`

The `nest upgrade` command automates the mechanical steps of migrating to v12:

```bash
# Preview changes and generate an audit report without touching files
nest upgrade --dry-run

# Execute upgrade
nest upgrade
```

### Automated Transformations Executed by `nest upgrade`
1. Bumps all `@nestjs/*` packages to their v12 major versions.
2. Bumps TypeScript to v6.
3. Rewrites deprecated Webpack configuration references in `nest-cli.json` to Rspack.
4. Upgrades GraphQL configuration (`subscriptions-transport-ws` ➔ `graphql-ws`).
5. Swaps legacy `nats` dependencies for `@nats-io/transport-node`.
6. Migrates `@nestjs/config` validation schemas to Standard Schema.

---

## 2. Rspack Default Bundler & Webpack Deprecation

As of NestJS 12, **Rspack** is the default bundler for monorepos, and the CLI flags `--webpack` and `--webpackPath` are deprecated.

### `nest-cli.json` Configuration

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "apps/api/src",
  "compilerOptions": {
    "builder": "rspack",
    "typeCheck": true,
    "rspackPath": "rspack.config.js"
  }
}
```

### CLI Command Options

```bash
# Build using Rspack
nest build --builder rspack

# Watch with custom Rspack config
nest start --builder rspack --watch --rspackPath custom-rspack.config.js
```

---

## 3. Testing Stack: Vitest Default for ESM

NestJS 12 sets **Vitest** as the primary test runner for all ESM projects.

> **Jest on Node.js**: If staying on Jest with ESM, you **must run Node.js v24.9 or higher**. Node.js versions prior to 24.9 fail with `ERR_REQUIRE_ASYNC_MODULE` when loading NestJS 12 ESM packages.

### Vitest Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'node:path';

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

### Supertest Import Migration in E2E Tests

In pure ESM under Vitest, change namespace imports of `supertest` to default imports:

```typescript
// Legacy CommonJS
import * as request from 'supertest';

// Modern ESM / Vitest
import request from 'supertest';
```

---

## 4. Linting: Oxlint Default

New projects generated with `nest new` configure **oxlint** by default. Oxlint is 50-100x faster than legacy ESLint, making CI/CD linting checks virtually instantaneous:

```bash
pnpm add -D oxlint
```

In `package.json`:
```json
{
  "scripts": {
    "lint": "oxlint --type-aware src/ test/"
  }
}
```

---

## 5. New CLI Flags & Commands

| Flag / Command | Scope | Purpose |
| :--- | :--- | :--- |
| `nest deploy` | Deployment | Direct cloud deployment targeting [Mau](https://mau.nestjs.com/) on AWS. |
| `--emit-declarations` | SWC Compiler | Emits `.d.ts` declaration files when using `--builder swc`. |
| `--no-type-check` | SWC Compiler | Explicitly skips asynchronous `tsc --noEmit` type checking. |
| `--silent` | Build / Start | Suppresses informational compiler logs in CI/CD pipelines. |
| `--parallel [concurrency]` | Monorepo Build | Builds all monorepo applications and libraries in parallel. |
| `includeLibraryAssets` | `nest-cli.json` | Automatically copies assets from monorepo libraries into application builds. |

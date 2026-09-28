# NestJS CLI & Workspace Architecture Standards

> **Domain**: Developer Tooling, Project Scaffolding, Monorepo Orchestration & Compilation  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/cli`, `@nestjs/schematics`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The [Nest CLI](https://github.com/nestjs/nest-cli) is the official command-line interface for developing, maintaining, and scaling enterprise NestJS applications. Built on top of pluggable schematic engines, it automates architectural consistency by generating domain components adhering to enterprise patterns, coordinates builds across standard and monorepo workspace structures, and manages multi-builder toolchains (`tsc`, `swc`, and `rspack`).

```text
                                NEST CLI ECOSYSTEM & PIPELINE
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
           ┌──────────────────────┐                       ┌──────────────────────┐
           │   Project Creation   │                       │ Schematic Generation │
           │  • nest new <app>    │                       │  • nest g <schematic>│
           │  • ESM (Vitest/oxlint)│                      │  • Modules, Services │
           │  • CJS (Jest/oxlint) │                       │  • Apps & Libraries  │
           └──────────┬───────────┘                       └───────────┬──────────┘
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              ▼
                                 ┌─────────────────────────┐
                                 │ Workspace Configuration │
                                 │    (nest-cli.json)      │
                                 │  • Global Compiler Opts │
                                 │  • Project Schemas      │
                                 │  • Assets & Glob Specs  │
                                 └────────────┬────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         ┌─────────────────────────┐                     ┌─────────────────────────┐
         │      Standard Mode      │                     │      Monorepo Mode      │
         │  • Standalone App       │                     │  • apps/ & libs/        │
         │  • Default Builder: tsc │                     │  • Default: Rspack      │
         │  • Single package.json  │                     │  • Path Aliases (@app)  │
         └────────────┬────────────┘                     └────────────┬────────────┘
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              ▼
                                 ┌─────────────────────────┐
                                 │   Compiler Toolchains   │
                                 ├─────────────────────────┤
                                 │ • tsc: Standard TS AST  │
                                 │ • swc: Rust fast JIT    │
                                 │ • rspack: Rust Bundler  │
                                 └────────────┬────────────┘
                                              ▼
                      ┌───────────────────────────────────────┐
                      │    Execution, Migration & Deploy      │
                      │  • nest start --watch (Live Reload)   │
                      │  • nest upgrade (v12 Engine Migrator) │
                      │  • nest deploy (Mau Cloud Deployment) │
                      └───────────────────────────────────────┘
```

---

## 1. Project Organization Modes: Standard vs. Monorepo

Nest provides two organizational paradigms. Switching from standard mode to monorepo mode is fully automated through `nest generate app <appName>`:

| Dimension | Standard Mode (`nest new`) | Monorepo Mode (`nest generate app` / `library`) |
| :--- | :--- | :--- |
| **Directory Topology** | Flat hierarchy rooted at `src/` and `test/`. | Nested hierarchy under `apps/<name>/` and `libs/<name>/`. |
| **Workspace Scope** | Single isolated application per repository. | Multi-application & multi-library workspace in a unified tree. |
| **Dependencies & Config** | Isolated `package.json`, `tsconfig.json`, and lockfile. | Root `package.json` and `tsconfig.json` shared across apps and libs. |
| **Default Compiler** | `tsc` (TypeScript compiler) or optional `swc`. | `rspack` (Rust-based high-performance bundler) or `tsc`/`swc`. |
| **Code Sharing** | Packaged externally via npm registries or submodules. | Zero-overhead internal libraries with automatic `@app/*` path mapping. |
| **Target Resolution** | Single project implicitly targeted by all commands. | Commands target `"root"` default project unless `--project` is specified. |
| **Asset Distribution** | `assets` copied directly relative to `src/`. | Supports `includeLibraryAssets` across monorepo project boundaries. |

---

## 2. Builder Matrix Comparison (`tsc`, `swc`, `rspack`)

In NestJS 12, the CLI provides first-class support for three compilation and bundling backends via the `compilerOptions.builder` setting in `nest-cli.json`:

| Feature / Metric | `tsc` (Default Standard) | `swc` (Speed-Optimized) | `rspack` (Default Monorepo) |
| :--- | :--- | :--- | :--- |
| **Underlying Engine** | Official TypeScript Compiler | Rust-based SWC compiler | Rust-based Webpack-compatible Bundler |
| **Build Performance** | Baseline (1x speed) | High (~10x faster than `tsc`) | Ultra-fast bundling for massive monorepos |
| **Output Format** | Discrete files (`.js`, `.d.ts`) per `.ts` source | Discrete files (`.js`, `.d.ts` if enabled) | Single consolidated bundle file |
| **Type Checking** | Full type checking during build | Transpilation only (run `tsc --noEmit` or `--type-check`) | Transpilation only during bundle pass |
| **Declaration Emission** | Native via `declaration: true` | Requires `--emit-declarations` flag | Bundles code; `.d.ts` generated via separate pass |
| **AST Plugins** | Fully supported (`@nestjs/swagger`, `@nestjs/graphql`) | Fully supported via SWC plugins | Supported via Rspack plugin pipeline |
| **Watch Mode** | Built-in watcher, supports `manualRestart` (`rs`) | Rapid incremental rebuilds | Instant Hot-Module-Replacement / rebuild |

---

## 3. CLI Documentation Suite Index

Explore the comprehensive guides covering the complete Nest CLI engineering lifecycle:

1. **[01 - CLI Architecture & Foundation](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/cli/01-overview.md)**: Global vs. local CLI binary resolution, system prerequisites (Node.js 20.11+ / 22.22.3+, ICU verification), initial project bootstrapping (`nest new`), ESM vs. CommonJS scaffolds, and command syntax.
2. **[02 - Workspace & Monorepo Topology](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/cli/02-workspaces.md)**: Multi-project monorepo structures, automated migration from standard mode via `nest g app`, complete `nest-cli.json` schema specification, compiler options, and non-TypeScript asset distribution rules.
3. **[03 - Monorepo Libraries Architecture](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/cli/03-libraries.md)**: Decoupling application features into modular libraries (`libs/`), `@app/*` TypeScript path mapping, module exporting via `index.ts`, test runner integration (Vitest & Jest `moduleNameMapper`), and Rspack packaging.
4. **[04 - CLI Command Reference & Schematics](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/cli/04-usage.md)**: Exhaustive reference of every CLI command (`new`, `generate`, `build`, `start`, `add`, `upgrade`, `deploy`, `info`), all schematics (from `controller` to v12 `decorator` and `resource`), and production deployment with **Mau**.
5. **[05 - Scripts & Compiler Toolchains](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/cli/05-scripts.md)**: NPM/PNPM script orchestration, enforcing project-local CLI parity across engineering teams, compiler deep dives (`tsc`, `swc`, `rspack`), and migrating from legacy `ts-node` / `tsc-watch` / Webpack configurations.

---

## 4. Engineering Standards Checklist

- [ ] **Execute via Local Package Runner**: Never rely on a developer's global `nest` CLI. Always invoke commands via `pnpm nest`, `pnpm run build`, or `npx @nestjs/cli` to guarantee identical CLI and schematics versions across the entire team and CI/CD pipelines.
- [ ] **Verify ICU Internationalization**: Confirm that Node.js runs with full ICU support (`node -p process.versions.icu`) to prevent localization parsing failures during scaffolding.
- [ ] **Select the Appropriate Builder**: Use `swc` for fast local standard application compiles, or `rspack` for monorepos requiring single-file distribution and sub-second builds.
- [ ] **Manage Spec File Generation**: Configure `generateOptions.spec` in `nest-cli.json` to enforce testing policies across the organization (e.g., disabling spec files for DTOs while requiring them for services and controllers).
- [ ] **Configure Non-TypeScript Assets**: Explicitly declare GraphQL schemas, templates, and binary assets in `compilerOptions.assets` with `watchAssets: true` so they are copied to `dist/` on build and watch cycles.
- [ ] **Synchronize Test Runners with Monorepo Path Aliases**: When using monorepo libraries with path aliases (`@app/*`), mirror the mappings in Vitest `resolve.alias` or Jest `moduleNameMapper` to avoid runtime resolution failures during unit and e2e testing.

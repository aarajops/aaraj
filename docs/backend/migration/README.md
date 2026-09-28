# NestJS 12 Migration Guide & Enterprise Upgrade Standards

> **Domain**: Major Version Migration, Breaking Changes & Framework Modernization  
> **Target Release**: NestJS v12.x (from v11.x)  
> **Runtime Baseline**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript 5.8+

NestJS version 12 marks a generational shift in the framework architecture: core packages are now shipped as pure **ECMAScript Modules (ESM)**, **Standard Schema V1** (Zod, Valibot, ArkType) is supported natively across validation and serialization, **Rspack** succeeds Webpack as the primary monorepo bundler, and **Vitest** + **oxlint** become the default tooling stack.

```text
                             NESTJS 12 ARCHITECTURE EVOLUTION
                                             │
      ┌──────────────────────────────────────┼──────────────────────────────────────┐
      ▼                                      ▼                                      ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│     Module & Runtime      │  │     Validation & Spec     │  │    Tooling & Compilers    │
├───────────────────────────┤  ├───────────────────────────┤  ├───────────────────────────┤
│ • Pure ESM Core Packages  │  │ • Standard Schema V1      │  │ • Rspack Default Bundler  │
│ • Node 24 LTS / 22.12+    │  │ • Zod @nestjs/config      │  │ • Vitest Native Runner    │
│ • Hierarchy Hook Order    │  │ • SerializerInterceptor   │  │ • Oxlint High-Speed Lint  │
│ • No @Optional Inheritance│  │ • Machine Error Codes     │  │ • nest upgrade CLI Tool   │
│ • Terminus Health Service │  │ • Route Conflict Policies │  │ • Mau AWS Deployment      │
└───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

---

## 1. Migration Documentation Suite Taxonomy

| Guide | Focus Area | Core Technologies | Migration Impact |
| :--- | :--- | :--- | :--- |
| **[01 - Core Breaking Changes](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/migration/01-breaking-changes.md)** | Runtime, DI & Protocol Breaks | Node 24/22.12+, `@Optional()`, Hooks, Terminus, NATS v3, GraphQL | Breaking changes across DI reflection, lifecycle hook orders, and third-party transport packages. |
| **[02 - CLI, Tooling & Compilers](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/migration/02-cli-tooling-and-compilers.md)** | Build Toolchain & Bundlers | `nest upgrade`, Rspack, Webpack deprecation, Vitest, Oxlint | Transitioning monorepos to Rspack, adopting Vitest test runners, and automated upgrades. |
| **[03 - Standard Schema & New Features](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/migration/03-standard-schema-and-features.md)** | Schema-First Architecture & APIs | Standard Schema, Zod Config, Route Conflicts, Machine Error Codes | Native Zod validation pipes, response serializers, conflict detection, and structured logging. |
| **[04 - ESM Migration Playbook](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/migration/04-esm-migration-playbook.md)** | Codebase ESM Transition | `"type": "module"`, `NodeNext`, `.js` relative imports, `import.meta` | Step-by-step guide for migrating legacy CommonJS codebases to modern pure ESM. |

---

## 2. Upgrade Quickstart (`nest upgrade`)

Nest CLI provides an automated migration command that bumps all `@nestjs/*` dependencies, applies mechanical configurations, and prints a diagnostics report:

```bash
# 1. Update global CLI tools
pnpm add -g @nestjs/cli@latest @nestjs/schematics@latest

# 2. Preview migration changes without modifying files
nest upgrade --dry-run

# 3. Execute migration
nest upgrade
```

---

## 3. Node.js Runtime Requirements

| Context | Supported Node.js Versions | Notes |
| :--- | :--- | :--- |
| **Running Application** | **Node.js v20.19+**, or **v22.12+** / **v24 LTS** | Required for unflagged `require(esm)` interop. Node 21.x and 23.x are unsupported. |
| **CLI & Schematics (`nest g`)** | **Node.js v22.22.3+**, **v24.15+**, or **v26+** | Required by Angular devkit dependencies inside `@nestjs/schematics`. |
| **AWS Lambda** | Node.js 20, 22, 24 | Must set `NODE_OPTIONS=--experimental-require-module` if running CommonJS. |

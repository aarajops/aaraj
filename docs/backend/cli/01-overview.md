# CLI Architecture & Foundation

> **Domain**: Developer Tooling & Lifecycle Management  
> **Source Reference**: [NestJS CLI Overview](https://docs.nestjs.com/cli/overview)  
> **Package**: `@nestjs/cli` | `@nestjs/schematics`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

The [Nest CLI](https://github.com/nestjs/nest-cli) is a command-line interface that scaffolds, builds, runs, and maintains enterprise NestJS applications. Beyond simple code generation, the CLI enforces architectural patterns, manages TypeScript AST transformation plugins (such as automated OpenAPI and GraphQL schema decorators), coordinates compiler toolchains (`tsc`, `swc`, `rspack`), and facilitates seamless cloud deployment.

---

## 1. Installation & Execution Strategies

There are two primary paradigms for invoking the Nest CLI: global system installation and project-local managed execution.

### Global Installation

Installing the CLI globally allows invoking the `nest` binary directly from any shell:

```bash
# Install globally via npm
npm install -g @nestjs/cli

# Alternatively, via pnpm
pnpm add -g @nestjs/cli
```

> [!NOTE]
> When `@nestjs/cli` is installed globally, every project executed on the host shares the exact same CLI binary version. This can introduce discrepancies across teams if developers run different global versions.

### Managed & Local Project Execution (Recommended)

In modern enterprise workflows and continuous integration (CI) environments, managing the CLI as a project development dependency in `package.json` guarantees strict version parity across all engineering machines:

```bash
# Execute without global installation using pnpm dlx or npx
pnpm dlx @nestjs/cli@latest new my-nest-project
# or
npx @nestjs/cli@latest new my-nest-project

# Inside an existing project with @nestjs/cli installed as a devDependency:
pnpm nest --help
# or via npm run scripts
pnpm run build
```

---

## 2. System & Runtime Requirements

The NestJS CLI and its underlying schematic engines require modern Node.js runtimes built with internationalization support:

| Component | Minimum Version | Recommended Version |
| :--- | :--- | :--- |
| **Nest CLI Binary (`@nestjs/cli`)** | Node.js **v20.11+** | Node.js **v24 LTS** |
| **Schematics Engine (`@nestjs/schematics`)** | Node.js **v22.22.3+**, **v24.15+**, or **v26+** | Node.js **v24 LTS** |
| **Package Managers** | npm 10+, pnpm 9+, Yarn 4+, Bun 1+ | **pnpm 12.5.1+** |

### Internationalization Support (ICU) Check

The schematics underlying `nest new`, `nest generate`, and `nest upgrade` require a Node.js binary compiled with internationalization support ([ICU](https://nodejs.org/api/intl.html)). Verify that your local and CI Node.js environments meet this requirement:

```bash
node -p process.versions.icu
```

If the command prints `undefined`, the Node.js runtime lacks internationalization support and schematics will fail during execution. Official binaries distributed via [nodejs.org](https://nodejs.org/en/download) include ICU by default.

---

## 3. Basic Development Workflow

### Creating a New Project

To scaffold a new NestJS project, navigate to the target directory and run:

```bash
nest new my-nest-project
```

During initialization, the CLI guides you through an interactive setup prompt:

1. **Package Manager Selection**: Choose between `pnpm`, `npm`, `yarn`, or `bun`.
2. **Module System Selection**:
   - **ESM (Default)**: Scaffolds a modern, pure ECMAScript Modules layout using [Vitest](https://vitest.dev/) for unit and integration testing, and [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for ultra-fast linting.
   - **CommonJS**: Scaffolds the traditional layout using [Jest](https://jestjs.io/) and oxlint.
3. **Observability Integration**: Prompts to configure `@nestjs/observe` for automated application performance monitoring (APM) and distributed tracing.

```bash
# Non-interactive scaffolding for automated CI/CD pipelines
nest new my-nest-project --package-manager pnpm --language TS --strict --skip-git
```

### Running in Development Mode

Once scaffolded, change into the project directory and start the local development server:

```bash
cd my-nest-project
pnpm run start:dev
```

By default, the server bootstraps on port `3000` (e.g., `http://localhost:3000`). The process continuously watches the filesystem and recompiles upon every detected source file modification.

> [!TIP]
> **10x Faster Builds with SWC**: By default, standard mode projects compile using `tsc`. For significantly faster incremental compilation during development, configure the [SWC builder](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/05-scripts.md) by passing `--builder swc` or setting `"builder": "swc"` in `nest-cli.json`.

---

## 4. Project Structures: Standard vs. Monorepo

When initializing an application, the CLI creates a **Standard Mode** structure. When enterprise needs expand to multiple microservices or shared internal libraries, the project can be upgraded to **Monorepo Mode** at any time using `nest generate app <name>` or `nest generate library <name>`.

```text
       STANDARD MODE                           MONOREPO MODE
   ┌───────────────────┐                   ┌───────────────────┐
   │  my-project/      │                   │  my-workspace/    │
   │  ├── src/         │                   │  ├── apps/        │
   │  │   ├── main.ts  │                   │  │   ├── api/     │
   │  │   └── app.*    │                   │  │   └── worker/  │
   │  ├── test/        │                   │  ├── libs/        │
   │  ├── nest-cli.json│                   │  │   └── common/  │
   │  ├── package.json │                   │  ├── nest-cli.json│
   │  └── tsconfig.json│                   │  ├── package.json │
   └───────────────────┘                   │  └── tsconfig.json│
                                           └───────────────────┘
```

| Feature | Standard Mode | Monorepo Mode |
| :--- | :--- | :--- |
| **Multiple Projects** | Separate file system trees per repository | Single file system tree with `apps/` and `libs/` |
| **`node_modules` & `package.json`** | Dedicated instances per application | Shared across the entire monorepo root |
| **Default Compiler** | `tsc` (or `swc`) | `rspack` (bundles applications and internal libs) |
| **Compiler Options** | Configured independently per repo | Centralized in `nest-cli.json` with per-project overrides |
| **Lint & Formatter Config** | Isolated per application | Centrally shared across all apps and libs |
| **Command Targeting** | Targets the single application in scope | Defaults to `"root"` project or uses `--project <name>` |
| **Library Management** | Packaged and published via npm | Built-in zero-build `@app/*` TypeScript path mapping |

---

## 5. CLI Command Syntax & Structure

All Nest CLI commands follow a standardized syntax:

```bash
nest commandOrAlias requiredArg [optionalArg] [options]
```

### Examples & Aliases

```bash
# Full command syntax with explicit flags
nest new customer-portal --package-manager pnpm --dry-run

# Equivalent command using command alias 'n' and flag alias '-d'
nest n customer-portal -p pnpm -d

# Inspecting command-specific arguments and options
nest generate --help
```

---

## 6. Command Overview Reference

| Command | Alias | Description | Detailed Reference |
| :--- | :--- | :--- | :--- |
| `new` | `n` | Scaffolds a new standard-mode NestJS application with all boilerplate files. | [Command Reference: new](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#1-nest-new) |
| `generate` | `g` | Generates and/or modifies source files based on schematic templates (controllers, services, modules, resources). | [Command Reference: generate](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#2-nest-generate) |
| `build` | | Compiles an application or monorepo workspace into an output directory (`dist/`). | [Command Reference: build](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#3-nest-build) |
| `start` | | Compiles and executes an application (or the default workspace project). | [Command Reference: start](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#4-nest-start) |
| `add` | | Imports an external library packaged with custom Nest schematics and executes its setup. | [Command Reference: add](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#5-nest-add) |
| `upgrade` | `update` | Upgrades an existing project to the latest NestJS major version (v12) and applies automated AST migrations. | [Command Reference: upgrade](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#6-nest-upgrade) |
| `deploy` | | Deploys the application directly to AWS cloud infrastructure powered by Mau. | [Command Reference: deploy](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#7-nest-deploy) |
| `info` | `i` | Displays diagnostic information about installed Nest packages, runtime versions, and system environment. | [Command Reference: info](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/cli/04-usage.md#8-nest-info) |

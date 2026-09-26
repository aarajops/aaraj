# Workspaces & Monorepo Architecture

> **Domain**: Monorepo Topology, Workspace Coordination & Build Configuration  
> **Source Reference**: [NestJS Workspaces Documentation](https://docs.nestjs.com/cli/monorepo)  
> **Configuration File**: `nest-cli.json`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Modern enterprise architectures often group multiple related backend applications (APIs, worker services, cron daemons) and shared libraries (database schemas, authentication policies, domain models) into a unified codebase. Nest provides built-in **monorepo mode** support, driven by a workspace configuration file (`nest-cli.json`), to streamline multi-project builds, sharing, and compilation.

---

## 1. Standard Mode vs. Monorepo Mode

Nest categorizes code organization into two modes:

- **Standard Mode (Default)**: Suited for standalone, focused applications with their own independent dependencies and compiler settings. Created via `nest new <name>`.
- **Monorepo Mode**: Models code artifacts as parts of a lightweight workspace. It automates build processes, simplifies module composition across applications, shares root dependencies (`package.json`), and provides built-in path mapping for shared libraries.

```text
       STANDARD MODE                           MONOREPO MODE
   ┌───────────────────────┐               ┌───────────────────────┐
   │ my-service/           │               │ my-enterprise-repo/   │
   │ ├── src/              │               │ ├── apps/             │
   │ │   ├── app.module.ts │               │ │   ├── api-gateway/  │
   │ │   └── main.ts       │               │ │   └── auth-worker/  │
   │ ├── test/             │               │ ├── libs/             │
   │ ├── nest-cli.json     │               │ │   ├── database/     │
   │ ├── package.json      │               │ │   └── common-dtos/  │
   │ └── tsconfig.json     │               │ ├── nest-cli.json     │
   └───────────────────────┘               │ ├── package.json      │
                                           │ └── tsconfig.json     │
                                           └───────────────────────┘
```

---

## 2. Converting Standard Mode to Monorepo Mode

You can convert any standard Nest application into a monorepo workspace at any time. To perform the conversion, execute `nest generate app <appName>` inside an existing standard project:

```bash
cd my-project
nest generate app worker-service
```

### Automated Workspace Transformation

The schematic automatically restructures the filesystem into a canonical monorepo:

1. Creates an `apps/` directory at the repository root.
2. Moves the original application's `src/` and `test/` folders into `apps/my-project/`.
3. Scaffolds the new application into `apps/worker-service/`.
4. Generates a project-specific `tsconfig.app.json` inside each project folder that extends the root `tsconfig.json`.
5. Updates `nest-cli.json` with `"monorepo": true`, sets the original application as the default project (`"root"`), and registers both entries under the `"projects"` property.

```text
my-enterprise-repo/
├── apps/
│   ├── my-project/              <-- Original application (default project)
│   │   ├── src/
│   │   │   ├── app.controller.ts
│   │   │   ├── app.module.ts
│   │   │   ├── app.service.ts
│   │   │   └── main.ts
│   │   ├── test/
│   │   └── tsconfig.app.json
│   └── worker-service/          <-- Newly generated application
│       ├── src/
│       │   ├── worker.controller.ts
│       │   ├── worker.module.ts
│       │   ├── worker.service.ts
│       │   └── main.ts
│       ├── test/
│       └── tsconfig.app.json
├── nest-cli.json                <-- Monorepo configuration
├── package.json                 <-- Shared root dependencies
└── tsconfig.json                <-- Shared root TypeScript compiler options
```

> [!WARNING]
> Automated conversion relies on the canonical standard structure (`src/` and `test/` at root). If your project deviates from this canonical structure before conversion, the schematic may fail to locate source files. Ensure standard folders are present before executing `nest g app`.

---

## 3. Workspace Project Taxonomy

Within a monorepo, a project is categorized as either:

1. **Application (`"type": "application"`)**: A full, independently bootable and deployable Nest application containing a `main.ts` bootstrap entry point. Applications reside under `apps/`.
2. **Library (`"type": "library"`)**: A reusable suite of components (providers, modules, interceptors) that cannot execute independently and contains no `main.ts`. Libraries export their public API through an `index.ts` file and reside under `libs/`.

### The Default Project

Every monorepo designates one application as the **default project**, configured via the top-level `"root"` property in `nest-cli.json`. 

When CLI commands like `nest start` or `nest build` are executed without specifying a target project, they operate on the default project:

```bash
# Starts the default project (apps/my-project)
nest start

# Starts an explicit application within the monorepo
nest start worker-service

# Builds an explicit application within the monorepo
nest build worker-service
```

---

## 4. `nest-cli.json` Schema Specification

The `nest-cli.json` file coordinates compiler choices, build artifacts, asset copying, and schematic defaults. Below is a production configuration for a monorepo workspace:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "apps/my-project/src",
  "monorepo": true,
  "root": "apps/my-project",
  "compilerOptions": {
    "deleteOutDir": true,
    "builder": "rspack",
    "tsConfigPath": "apps/my-project/tsconfig.app.json",
    "assets": [
      {
        "include": "**/*.proto",
        "outDir": "dist/apps/my-project",
        "watchAssets": true
      }
    ],
    "manualRestart": true
  },
  "generateOptions": {
    "spec": {
      "service": true,
      "s": true,
      "controller": true,
      "co": true
    },
    "flat": false
  },
  "projects": {
    "my-project": {
      "type": "application",
      "root": "apps/my-project",
      "entryFile": "main",
      "sourceRoot": "apps/my-project/src",
      "compilerOptions": {
        "tsConfigPath": "apps/my-project/tsconfig.app.json"
      }
    },
    "worker-service": {
      "type": "application",
      "root": "apps/worker-service",
      "entryFile": "main",
      "sourceRoot": "apps/worker-service/src",
      "compilerOptions": {
        "tsConfigPath": "apps/worker-service/tsconfig.app.json"
      }
    },
    "shared-kernel": {
      "type": "library",
      "root": "libs/shared-kernel",
      "entryFile": "index",
      "sourceRoot": "libs/shared-kernel/src",
      "compilerOptions": {
        "tsConfigPath": "libs/shared-kernel/tsconfig.lib.json"
      }
    }
  }
}
```

---

## 5. Global Compiler Options Reference

These settings control compiler execution across all projects in the workspace:

| Property Name | Type | Description |
| :--- | :--- | :--- |
| `builder` | `string` \| `object` | Specifies the compilation engine: `"tsc"`, `"swc"`, or `"rspack"`. Can also be defined as an object `{ "type": "rspack", "options": { ... } }`. |
| `deleteOutDir` | `boolean` | When `true`, purges the output directory (`dist/`) before every compilation pass. Defaults to `false`. |
| `tsConfigPath` | `string` | (**Monorepo only**) Path to the default project's `tsconfig.json` used when `nest build` or `nest start` runs without `--project`. |
| `assets` | `array` | Non-TypeScript files to distribute during build. See [Static Asset Distribution](#7-static-asset-distribution). |
| `watchAssets` | `boolean` | When `true`, watches non-TypeScript files during development watch mode (`--watch`). |
| `manualRestart` | `boolean` | When `true` (with `tsc`), enables typing `rs` in the terminal to trigger a manual process reboot. |
| `typeCheck` | `boolean` | Enables type checking when using the SWC builder (`builder: "swc"`). Defaults to `false`. |
| `emitDeclarations` | `boolean` | Emits `.d.ts` declaration files when using the SWC builder. Defaults to `false`. |
| `includeLibraryAssets` | `string[]` | (**Monorepo only**) Array of library names whose static assets should also be copied when building an application. |
| `webpack` | `boolean` | *(Deprecated)* Legacy flag for webpack. Use `"builder": "rspack"` instead. |
| `webpackConfigPath` | `string` | *(Deprecated)* Legacy webpack config path. Use builder-specific options instead. |

> [!WARNING]
> **Compiler Options Overwrite Rule in Monorepos**: In monorepo mode, project-level `compilerOptions` defined under `"projects"` do **not** merge with top-level `compilerOptions`. Specifying an `assets` array at the project level completely overrides the global `assets` array. To distribute a shared library's assets into an application build, explicitly list the library in `includeLibraryAssets`.

---

## 6. Schematic Generate Options

You can control automated code generation behavior globally and per project via `generateOptions`:

```json
{
  "generateOptions": {
    "spec": false,
    "flat": false
  }
}
```

### Granular Spec Configuration & Alias Handling

When disabling or enabling unit test generation (`spec`) per schematic, `nest` matches the exact schematic name. Because schematic aliases (e.g. `s` for `service`, `co` for `controller`) are treated as distinct keys by the schematics parser, **always configure both the full name and alias**:

```json
{
  "generateOptions": {
    "spec": {
      "service": false,
      "s": false,
      "controller": true,
      "co": true,
      "guard": true,
      "gu": true
    }
  }
}
```

### Order of Precedence

Generate options are evaluated in the following hierarchy:
1. **Command-line flags** (e.g., `nest g s auth --no-spec`) take highest precedence.
2. **Project-specific options** (defined inside `projects.<projectName>.generateOptions`).
3. **Global options** (defined in top-level `generateOptions`).

---

## 7. Static Asset Distribution

TypeScript compilers emit only transpiled `.js` and `.d.ts` files into the `dist/` directory. If your service requires non-TypeScript files (such as `.graphql` schemas, Protocol Buffer `.proto` definitions, HTML templates, or email assets), you must declare them in the `assets` array.

> [!IMPORTANT]
> **Source Directory Requirement**: All declared assets must reside within the project's `src/` directory; assets outside `src/` are omitted by the compiler copy pipeline.

### Glob String Syntax

```json
{
  "compilerOptions": {
    "assets": ["**/*.graphql", "**/*.proto", "templates/**/*"],
    "watchAssets": true
  }
}
```

### Advanced Object Syntax

For granular control over destinations and exclusions, define assets as objects:

```json
{
  "compilerOptions": {
    "assets": [
      {
        "include": "**/*.graphql",
        "exclude": "**/deprecated.graphql",
        "outDir": "dist/apps/api/schemas",
        "watchAssets": true
      },
      {
        "include": "mail/templates/**/*",
        "watchAssets": false
      }
    ]
  }
}
```

| Asset Option | Type | Description |
| :--- | :--- | :--- |
| `include` | `string` | Glob-like file match pattern. |
| `exclude` | `string` | Glob-like exclusion pattern filtering files from `include`. |
| `outDir` | `string` | Destination path relative to the workspace root. Defaults to compiler output directory. |
| `watchAssets` | `boolean` | Watches these assets for changes during development. Overridden if global `watchAssets` is set. |

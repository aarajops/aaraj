# CLI Command Reference & Schematics

> **Domain**: CLI Operations, Schematics Code Generation & Lifecycle Commands  
> **Source Reference**: [NestJS CLI Usage Reference](https://docs.nestjs.com/cli/usages)  
> **Package**: `@nestjs/cli`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

This chapter provides an exhaustive reference for all commands, arguments, schematics, and flags supported by the NestJS CLI.

---

## 1. `nest new`

Scaffolds a new standard-mode NestJS application with all boilerplate files and configuration.

```bash
nest new <name> [options]
nest n <name> [options]
```

### Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--directory [dir]` | | Destination directory for the scaffolded project. |
| `--dry-run` | `-d` | Simulates file generation without modifying the filesystem. |
| `--skip-git` | `-g` | Skips Git repository initialization. |
| `--skip-install` | `-s` | Skips package manager installation step. |
| `--skip-tests` | `-t` | Skips generating initial test files (`.spec.ts` and `test/` folder). |
| `--package-manager [pm]`| `-p` | Package manager: `pnpm`, `npm`, `yarn`, or `bun`. |
| `--language [lang]` | `-l` | Language: `TS` (default) or `JS`. |
| `--collection [name]` | `-c` | Custom schematic collection to invoke. |
| `--strict` | | Enforces TypeScript `strict` mode in generated `tsconfig.json`. |
| `--format` | | Formats generated files using Prettier. |
| `--observe` / `--no-observe` | | Automatically provisions or skips the `@nestjs/observe` APM SDK without prompting. |

---

## 2. `nest generate`

Generates and/or modifies application files based on Nest schematics.

```bash
nest generate <schematic> <name> [options]
nest g <schematic> <name> [options]
```

### Available Schematics

| Schematic | Alias | Description |
| :--- | :--- | :--- |
| `app` | | Generates a new application within a monorepo (converts standard mode to monorepo). |
| `library` | `lib` | Generates a new library under `libs/` within a monorepo workspace. |
| `class` | `cl` | Generates a standard TypeScript class declaration. |
| `controller` | `co` | Generates a controller with `@Controller()` decorator and routing. |
| `decorator` | `d` | Generates a custom decorator (In NestJS 12, uses `Reflector.createDecorator()`). |
| `filter` | `f` | Generates an exception filter implementing `ExceptionFilter`. |
| `gateway` | `ga` | Generates a WebSocket gateway class with `@WebSocketGateway()`. |
| `guard` | `gu` | Generates an authorization guard implementing `CanActivate`. |
| `interface` | `itf` | Generates a TypeScript interface declaration. |
| `interceptor` | `itc` | Generates an interceptor implementing `NestInterceptor`. |
| `middleware` | `mi` | Generates an HTTP middleware implementing `NestMiddleware`. |
| `module` | `mo` | Generates a feature module annotated with `@Module()`. |
| `pipe` | `pi` | Generates a parameter validation pipe implementing `PipeTransform`. |
| `provider` | `pr` | Generates a general-purpose dependency injection provider. |
| `resolver` | `r` | Generates a GraphQL resolver annotated with `@Resolver()`. |
| `resource` | `res` | Scaffolds a complete CRUD resource (controller, service, entities, DTOs, tests). |
| `service` | `s` | Generates a service class annotated with `@Injectable()`. |

### Generate Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--dry-run` | `-d` | Simulates generation without altering disk state. |
| `--project [project]`| `-p` | Specific project within a monorepo to add the element to. |
| `--flat` / `--no-flat` | | Suppresses or enforces creating a dedicated subfolder for the element. |
| `--collection [name]` | `-c` | Specifies a custom schematics collection. |
| `--spec` / `--no-spec` | | Enforces or suppresses generating `.spec.ts` unit test files. |
| `--spec-file-suffix [suffix]` | | Customizes the test file suffix (e.g. `.unit-spec.ts`). |
| `--skip-import` | | Skips auto-importing the generated element into its nearest parent module. |
| `--format` | | Formats generated source code with Prettier. |
| `--type <type>` | | (`resource` only) Transport layer: `rest`, `graphql-code-first`, `graphql-schema-first`, `microservice`, or `ws`. |
| `--crud [boolean]` | | (`resource` only) Generates standard CRUD handlers (`true` or `false`). |

---

## 3. `nest build`

Compiles an application or monorepo workspace into production-ready output folders (`dist/`). Handles AST plugins (such as OpenAPI Swagger decorator inference), path mapping, and static asset distribution.

```bash
nest build [name...] [options]
```

### Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--path [path]` | `-p` | Path to custom `tsconfig.json` configuration file. |
| `--config [path]` | `-c` | Path to custom `nest-cli.json` configuration file. |
| `--watch` | `-w` | Runs compilation in continuous watch mode (live incremental recompiles). |
| `--builder [name]` | `-b` | Builder to use: `"tsc"`, `"swc"`, or `"rspack"`. |
| `--rspackPath [path]` | | Path to custom Rspack configuration file. |
| `--tsc` | | Forces compilation using `tsc`. |
| `--watchAssets` | | Watches non-TypeScript assets (`.graphql`, `.proto`, templates). |
| `--type-check` / `--no-type-check` | | Toggles type checking when using SWC. |
| `--emit-declarations` | | Emits `.d.ts` declaration files when using SWC. |
| `--all` | | Compiles all applications and libraries in a monorepo. |
| `--parallel [concurrency]` | | Builds projects in parallel (used with `--all`). |
| `--silent` | | Suppresses compiler informational logs. |
| `--preserveWatchOutput` | | Retains previous console output instead of clearing screen in `tsc` watch. |
| `--webpack` / `--webpackPath` | | *(Deprecated)* Legacy webpack compilation flags. Use Rspack instead. |

---

## 4. `nest start`

Compiles and executes an application (or the monorepo default project).

```bash
nest start [name] [options]
```

### Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--watch` | `-w` | Runs in watch mode (auto-recompiles and restarts Node process on file change). |
| `--builder [name]` | `-b` | Compiler engine: `"tsc"`, `"swc"`, or `"rspack"`. |
| `--debug [hostport]` | `-d` | Enables Node.js debug mode with `--inspect` (default: `127.0.0.1:9229`). |
| `--env-file [path]` | | Loads environment variables from an env file relative to cwd (can be repeated). |
| `--exec [binary]` | `-e` | Binary to execute compiled code (default: `node`). |
| `--no-shell` | | Disables spawning child processes within a shell. |
| `--sourceRoot [path]` | | Overrides the `sourceRoot` configuration in `nest-cli.json`. |
| `--entryFile [name]` | | Overrides the bootstrap entry file (default: `main`). |
| `-- [key=value]` | | Passes arguments directly through to the application via `process.argv`. |

---

## 5. `nest add`

Installs an external npm package and runs its official Nest schematic installer.

```bash
nest add <name> [options]
```

### Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--dry-run` | `-d` | Previews changes without executing package install or code modifications. |
| `--skip-install` | `-s` | Runs schematics without invoking package manager install. |
| `--project [project]` | `-p` | Target project within a monorepo workspace. |

---

## 6. `nest upgrade` (Alias: `nest update`)

Automates migration of existing projects to the latest NestJS major version (v12).

```bash
nest upgrade [options]
nest update [options]
```

### Migration Mechanics Performed

1. **Node.js Engine Verification**: Validates that Node.js supports `require(esm)` (Node.js >= 20.19.0 or v22.12+).
2. **Dependency Major Bumps**: Updates `@nestjs/*` core packages to v12-compatible majors (`@nestjs/graphql`, `@nestjs/apollo`, and `@nestjs/mercurius` to v14).
3. **TypeScript 6 & Tooling**: Bumps TypeScript to v6 and updates `engines.node` in `package.json` to `>=20.19.0`.
4. **Builder Modernization**: Migrates legacy `webpack` / `webpackConfigPath` configurations in `nest-cli.json` to modern `--builder rspack`.
5. **GraphQL Updates**: Renames `playground` option to `graphiql`, replaces `subscriptions-transport-ws` with `graphql-ws`.
6. **NATS Modernization**: Upgrades legacy `nats` to `@nats-io/transport-node` and `@nats-io/nats-core`.
7. **Joi & Config Validation**: Migrates Joi to v18 (Standard Schema compliance) and nests library-specific config options under `validationOptions.libraryOptions`.
8. **Test Runners**: Upgrades Jest to v30.
9. **Observability**: Prompts to wire up `@nestjs/observe`.

### Options

| Option | Alias | Description |
| :--- | :--- | :--- |
| `--dry-run` | `-d` | Simulates migrations and prints proposed diffs without writing to disk. |
| `--skip-install` | `-s` | Applies code and config migrations without running package install. |
| `--observe` / `--no-observe` | | Automatically toggles `@nestjs/observe` integration. |
| `--tag [tag]` | `-t` | Uses an npm dist-tag (e.g. `next`, `beta`) instead of release versions. |
| `--collection [name]` | `-c` | Custom schematic collection for upgrade. |

---

## 7. `nest deploy`

Deploys the application directly to AWS cloud infrastructure powered by [Mau](https://mau.nestjs.com/).

```bash
nest deploy [mau-options]
```

`nest deploy` forwards options directly to the underlying Mau deployment engine. If `@nestjs/mau` is not present in devDependencies, the CLI offers to install it. In automated CI/CD environments, install `@nestjs/mau` explicitly ahead of time:

```bash
pnpm add -D @nestjs/mau
pnpm nest deploy --env production
```

---

## 8. `nest info` (Alias: `nest i`)

Outputs diagnostic information detailing the local environment, runtime versions, CLI version, and installed Nest package versions:

```bash
nest info
```

```text
 _   _             _      ___  _____  _____  _     _____
| \ | |           | |    |_  |/  ___|/  __ \| |   |_   _|
|  \| |  ___  ___ | |_     | |\ `--. | /  \/| |     | |
| . ` | / _ \/ __|| __|    | | `--. \| |    | |     | |
| |\  ||  __/\__ \| |_ /\__/ //\__/ /| \__/\| |_____| |_
\_| \_/ \___||___/ \__|\____/ \____/  \____/\_____/\___/

[System Information]
OS Version     : Linux x86_64 6.6.137+
NodeJS Version : v24.19.0
NPM Version    : 10.9.0

[Nest CLI]
Nest CLI Version : 12.0.4

[Nest Platform Information]
platform-express version : 12.0.4
schematics version       : 12.0.4
testing version          : 12.0.4
common version           : 12.0.4
core version             : 12.0.4
cli version              : 12.0.4
```

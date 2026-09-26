# REPL Interactive Console

> **Domain**: Interactive Runtime Debugging, Inversion-of-Control Graph Inspection  
> **Source Reference**: [NestJS REPL Recipe](https://docs.nestjs.com/recipes/repl)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

A REPL (Read-Eval-Print Loop) is an interactive shell environment that takes single user commands, executes them against a running process, and returns the result. The NestJS REPL feature enables you to inspect your application's compiled dependency injection graph, invoke provider and controller methods live, test database repositories, and query system state directly from your terminal.

---

## 1. Bootstrapping the REPL

To initialize your application in REPL mode, create a dedicated entry file named `src/repl.ts` alongside your existing `main.ts`:

```typescript
// apps/api/src/repl.ts
import { repl } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const replServer = await repl(AppModule);

  // Preserve terminal command history across sessions and reloads
  replServer.setupHistory('.nestjs_repl_history', (err) => {
    if (err) {
      console.error('Failed to setup REPL history:', err);
    }
  });
}

await bootstrap();
```

> [!NOTE]
> The `repl()` function returns a promise that resolves to a standard [Node.js REPL Server](https://nodejs.org/api/repl.html) instance. You can pass custom Node.js REPL options (such as custom prompts or ignore undefined) as its second argument.

---

## 2. Launching the REPL Session

Start the REPL by specifying the entry file using the Nest CLI:

```bash
# Standard execution
pnpm run start -- --entryFile repl

# With continuous file watching (auto-recompiles on source changes)
pnpm run start -- --watch --entryFile repl
```

When successfully initialized, the console prints the bootstrapping logs followed by the interactive `>` prompt:

```text
LOG [NestFactory] Starting Nest application...
LOG [InstanceLoader] AppModule dependencies initialized
LOG [InstanceLoader] UsersModule dependencies initialized
LOG REPL initialized
>
```

---

## 3. Interactive Commands & DI Inspection

### Retrieving and Invoking Services

You can retrieve singleton instances by class token using `get()` (or its shorthand `$()`) and invoke methods directly:

```typescript
// Call a synchronous or asynchronous service method
> get(AppService).getHello()
'Hello World!'

// Assign instances to variables and await asynchronous promises
> const usersService = $(UsersService)
> const user = await usersService.findOneById(1)
> console.log(user)
{ id: 1, email: 'alex@araz.io', role: 'admin' }
```

### Inspecting Available Methods

To display all public methods declared on a provider or controller without inspecting source files:

```typescript
> methods(UsersController)

Methods:
 ◻ findAll
 ◻ findOne
 ◻ create
 ◻ update
 ◻ delete
```

### Dependency Graph Visualizer (`debug()`)

To display all registered modules, their controllers, and exported providers in a structured tree:

```typescript
// Print the complete workspace graph:
> debug()

AppModule:
 - controllers:
  ◻ AppController
 - providers:
  ◻ AppService
UsersModule:
 - controllers:
  ◻ UsersController
 - providers:
  ◻ UsersService
  ◻ UsersRepository

// Or inspect an isolated module:
> debug(UsersModule)
```

---

## 4. Native REPL Functions Reference

| Function | Signature | Description |
| :--- | :--- | :--- |
| `get` / `$` | `get(token: InjectionToken) => any` | Retrieves a singleton provider or controller instance. Throws if not found. |
| `resolve` | `resolve(token: InjectionToken, contextId: any) => Promise<any>` | Resolves a transient or request-scoped instance for a specific context ID. |
| `select` | `select(token: DynamicModule \| ClassRef) => INestApplicationContext` | Navigates the module tree to isolate providers within a specific submodule scope. |
| `methods` | `methods(token: ClassRef \| string) => void` | Lists all public methods exposed by a given provider or controller class. |
| `debug` | `debug(moduleCls?: ClassRef \| string) => void` | Dumps registered modules, controllers, and providers into a readable tree. |
| `help` | `help() => void` | Displays documentation for all native REPL functions and signatures. |

### Inspecting Signatures via `.help`

If you forget a function's arguments or return type, append `.help` to the function identifier:

```text
> resolve.help
Resolves transient or request-scoped instance of either injectable or controller, otherwise, throws exception.
Interface: resolve(token: InjectionToken, contextId: any) => Promise<any>
```

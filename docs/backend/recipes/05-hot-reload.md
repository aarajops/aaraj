# Hot-Module Replacement (HMR)

> **Domain**: Developer Ergonomics, Incremental Recompilation & Process Recycling  
> **Source Reference**: [NestJS Hot Reload Recipe](https://docs.nestjs.com/recipes/hot-reload)  
> **Build Tooling**: Webpack / Rspack  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

During active development, full process restarts can introduce noticeable latency when re-instantiating heavy dependency injection graphs, database connection pools, and queue listeners. Hot-Module Replacement (HMR) updates modified JavaScript modules in place without completely destroying the running application process.

> [!NOTE]
> **Modern NestJS 12 Guidance**: In NestJS 12, the legacy Webpack builder is deprecated in favor of **SWC watch mode** (`nest start -b swc -w`) and **Rspack** (`--builder rspack`). However, for legacy codebases or bundler-specific workflows, Webpack HMR remains supported as detailed below.

---

## 1. Installation

Install Webpack and the Node development plugins:

```bash
pnpm add -D webpack-node-externals run-script-webpack-plugin webpack
```

---

## 2. Configuration (`webpack-hmr.config.js`)

Create a `webpack-hmr.config.js` file in the root of your application:

```javascript
// webpack-hmr.config.js
const nodeExternals = require('webpack-node-externals');
const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');

module.exports = function (options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100'],
      }),
    ],
    plugins: [
      ...options.plugins,
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({
        name: options.output.filename,
        autoRestart: false,
      }),
    ],
  };
};
```

---

## 3. Bootstrap & Preventing `EADDRINUSE` Port Collisions

The primary failure mode with Node.js hot-reloading is port collision (`EADDRINUSE`), which happens when a reloaded module attempts to bind to `process.env.PORT` before the previous server instance has finished closing active TCP connections.

To prevent this, stash the `app.close()` promise on `module.hot.data.closePromise` and enable `forceCloseConnections`:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

declare const module: any;

async function bootstrap() {
  // 1. Wait for previous instance to fully release ports
  if (module.hot?.data?.closePromise) {
    await module.hot.data.closePromise;
  }

  // 2. Force close active keep-alive connections on reload
  const app = await NestFactory.create(AppModule, {
    forceCloseConnections: !!module.hot,
  });

  await app.listen(process.env.PORT ?? 3001);

  // 3. Register HMR lifecycle hooks
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose((data: any) => {
      data.closePromise = app.close();
    });
  }
}

bootstrap();
```

---

## 4. Execution Command

Add the HMR start script to `package.json`:

```json
{
  "scripts": {
    "start:hmr": "nest build --webpack --webpackPath webpack-hmr.config.js --watch"
  }
}
```

```bash
pnpm run start:hmr
```

# 16 - Sharing GraphQL Models

> **Source Reference**: [NestJS Official Documentation - Sharing Models](https://docs.nestjs.com/graphql/sharing-models)

> [!NOTE]
> Model shimming is an exclusive capability of the **Code First** approach.

One of the primary advantages of building a unified TypeScript monorepo is the ability to share data transfer objects (DTOs) and domain models across both backend services and frontend web applications (e.g. Next.js, Vite).

However, code-first backend models are heavily annotated with decorators (`@ObjectType()`, `@Field()`, `@InputType()`). If imported directly into a browser application, these decorators increase bundle size, trigger runtime reflection errors, and degrade frontend performance.

---

## 1. How the Model Shim Works

`@nestjs/graphql` includes a lightweight **model shim** (`graphql-model-shim`) that replaces all `@nestjs/graphql` decorators with no-op functions when compiled for browser targets.

The package configures the `browser` export condition in its `package.json`:

```json
{
  "exports": {
    ".": {
      "browser": "./dist/extra/graphql-model-shim.js",
      "default": "./dist/index.js"
    }
  }
}
```

Bundlers that automatically respect browser export conditions (such as Vite, esbuild, and Rollup) resolve the shim automatically with zero manual configuration.

---

## 2. Manual Bundler Aliasing

If your frontend uses a legacy bundler or custom Webpack configuration that does not resolve the `browser` export condition by default, configure an explicit module alias:

### Webpack Configuration

```javascript
// webpack.config.js
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  resolve: {
    alias: {
      '@nestjs/graphql': resolve(
        __dirname,
        '../node_modules/@nestjs/graphql/dist/extra/graphql-model-shim.js',
      ),
    },
  },
};
```

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@nestjs/graphql': '@nestjs/graphql/dist/extra/graphql-model-shim',
    },
  },
});
```

---

## 3. Recommended Monorepo Architecture

In an enterprise monorepo like Araz, the recommended pattern is:
1. Place shared data structures in `packages/contracts`.
2. Model pure business types without server-only framework dependencies.
3. In backend services (`apps/api`), extend or decorate these contracts using mapped types or code-first decorators.
4. In frontend applications (`apps/web`), consume the contracts directly as pure TypeScript types.

# ESM Migration Playbook: Moving Codebases to Pure ECMAScript Modules

> **Domain**: Module System Migration, NodeNext Resolution & Runtime Interop  
> **Framework Compatibility**: NestJS v12.x  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Migrating an existing NestJS application from CommonJS to pure ECMAScript Modules (ESM) is **optional**: NestJS 12 core packages are published as ESM but can be consumed by CommonJS projects via Node's native `require(esm)` support.

However, moving to native ESM provides significant long-term benefits: faster module resolution under Vitest and Rspack, elimination of dual-package hazard bugs, and alignment with modern JavaScript standards.

---

## 1. Project Configuration (`package.json`)

Declare your project as an ES module by adding `"type": "module"`:

```json
{
  "name": "@araz/api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "start": "node dist/src/main.js"
  }
}
```

---

## 2. TypeScript Compiler Configuration (`tsconfig.json`)

Configure TypeScript to resolve imports according to the official Node.js ESM loader algorithm using `NodeNext`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2023",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "types": ["vitest/globals", "node"]
  }
}
```

> **Important**: `"module": "nodenext"` instructs TypeScript to enforce the exact module resolution rules of Node.js. It requires that **every relative import specify a file extension**.

---

## 3. Codebase Changes: Relative Import Extensions

In NodeNext ESM, bare relative imports are illegal. Every relative import specifier **must include the `.js` extension** (referencing the emitted JavaScript file, even when authoring `.ts` source files):

```typescript
// INCORRECT (Fails with TS2835 in NodeNext)
import { UserService } from './user.service';
import { AuthModule } from '../auth/auth.module';

// CORRECT (NodeNext compliant)
import { UserService } from './user.service.js';
import { AuthModule } from '../auth/auth.module.js';
```

---

## 4. Replacing CommonJS Globals

In pure ESM, CommonJS global identifiers (`__dirname`, `__filename`, `require`) are undefined.

### Replace `__dirname` and `__filename`

```typescript
// Legacy CommonJS
import { join } from 'path';
const protoPath = join(__dirname, 'hero/hero.proto');

// Modern Node.js 22+ / 24 LTS ESM
import { join } from 'node:path';
const protoPath = join(import.meta.dirname, 'hero/hero.proto');
const currentFile = import.meta.filename;
```

### Replace `require()` with `createRequire()`

If an older CommonJS library lacks ESM exports and requires synchronous loading:

```typescript
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legacyPackage = require('legacy-cjs-pkg');
```

---

## 5. Test Runner & E2E Imports

### Supertest Default Import

In CommonJS, `supertest` was commonly imported as a namespace. In ESM, namespace imports are not callable functions; use default imports:

```typescript
// Legacy CommonJS
import * as request from 'supertest';

// Modern ESM
import request from 'supertest';

describe('AppController (e2e)', () => {
  it('/api/health (GET)', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});
```

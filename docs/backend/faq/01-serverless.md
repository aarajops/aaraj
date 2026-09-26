# Serverless Computing & Cold Start Optimization

> **Domain**: Serverless Architecture, AWS Lambda & Runtime Latency Optimization  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 22.x / 24 LTS / Pure ECMAScript Modules (ESM)

Serverless computing shifts the operational burden of provisioning, scaling, and maintaining physical or virtual infrastructure to the cloud provider (AWS Lambda, Google Cloud Run/Functions, Azure Functions). Compute resources are billed on-demand and allocated instantaneously per event execution.

When deploying NestJS into a serverless execution model, the primary architectural hurdle is the **cold start latency**—the initialization overhead incurred when a container is instantiated from an idle state.

---

## 1. The Cold Start Dilemma & Compilation Benchmarks

A cold start encompasses downloading the deployment package, initializing the Node.js runtime, parsing the JavaScript dependency graph, and executing the application bootstrap sequence (registering DI modules, compiling metadata, and establishing connections).

### Startup Latency Benchmarks (Unbundled vs. Bundled)

Startup time varies dramatically based on whether the application code is executed as discrete source files via `tsc` or bundled into a single tree-shaken executable via a bundler (Webpack, Rspack, or esbuild):

| Application Architecture | Unbundled (`tsc`) | Bundled (`webpack` / `rspack`) | Speedup Factor |
| :--- | :--- | :--- | :--- |
| **Raw Node.js Script** | `7.1 ms` | `6.6 ms` | `1.07x` |
| **Express Raw HTTP** | `7.9 ms` | `6.8 ms` | `1.16x` |
| **NestJS Standalone Context** | `111.7 ms` | `31.9 ms` | **`3.50x`** |
| **NestJS HTTP (`@nestjs/platform-express`)** | `197.4 ms` | `81.5 ms` | **`2.42x`** |

> **Key Takeaway**: Bundling application code and inlining `node_modules` eliminates filesystem I/O operations across thousands of nested modules on startup, reducing cold start latency by **58% to 71%**.

---

## 2. Runtime Optimization Strategies

### A. Avoid Blocking Asynchronous Providers
Asynchronous providers (`useFactory` returning a `Promise`) block the application bootstrap until they resolve. In a persistent container, a 2-second database connection handshake happens once; in serverless, every cold start inherits this delay.

* **Pattern**: Defer expensive connections until the invocation requires them, or maintain warm connection pools across Lambda invocations via global context caching.

### B. Lazy Module Loading with `LazyModuleLoader`
Load non-critical modules (e.g., PDF generation, image manipulation, external payment SDKs) on demand using [LazyModuleLoader](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/fundamentals/08-lazy-loading-modules.md):

```typescript
import { Injectable, type RequestMethod } from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';

@Injectable()
export class DispatcherService {
  constructor(private readonly lazyModuleLoader: LazyModuleLoader) {}

  async processRequest(type: string): Promise<any> {
    if (type === 'REPORT_EXPORT') {
      const { ReportingModule } = await import('./reporting/reporting.module.js');
      const moduleRef = await this.lazyModuleLoader.load(() => ReportingModule);

      const { ReportingService } = await import('./reporting/reporting.service.js');
      const service = moduleRef.get(ReportingService);

      return service.generateReport();
    }
  }
}
```

---

## 3. Full HTTP Serverless Implementation (AWS Lambda)

To execute a full NestJS HTTP routing tree behind AWS API Gateway or Application Load Balancer (ALB), use `@codegenie/serverless-express` to wrap the Express adapter.

### Step 1: Install Dependencies

```bash
pnpm add @codegenie/serverless-express
pnpm add -D @types/aws-lambda serverless serverless-offline
```

### Step 2: Configure Serverless Framework (`serverless.yml`)

```yaml
service: araz-serverless-api

plugins:
  - serverless-offline

provider:
  name: aws
  runtime: nodejs22.x
  memorySize: 512
  timeout: 10
  environment:
    NODE_ENV: production

functions:
  api:
    handler: dist/main.handler
    events:
      - http:
          method: ANY
          path: /
      - http:
          method: ANY
          path: '{proxy+}'
```

### Step 3: Serverless Entrypoint (`src/main.ts`)

Cache the bootstrapped server instance across warm Lambda invocations:

```typescript
import { NestFactory } from '@nestjs/core';
import serverlessExpress from '@codegenie/serverless-express';
import type { Callback, Context, Handler } from 'aws-lambda';
import { AppModule } from './app.module.js';

let cachedServer: Handler;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'], // Minimize logging overhead during bootstrap
  });

  // Critical for reverse-proxied Swagger UI behind API Gateway
  app.use((req: any, _res: any, next: any) => {
    if (req.originalUrl === '/swagger') {
      req.originalUrl = '/swagger/';
    }
    next();
  });

  await app.init();

  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (
  event: any,
  context: Context,
  callback: Callback,
) => {
  // Re-use cached server instance across warm container invocations
  cachedServer = cachedServer ?? (await bootstrap());
  return cachedServer(event, context, callback);
};
```

---

## 4. Standalone Context for Event-Driven Lambdas

When your serverless function consumes SQS queues, SNS topics, S3 bucket events, or EventBridge triggers, an HTTP router is unnecessary overhead. Use `NestFactory.createApplicationContext()` to initialize only the NestJS DI container:

```typescript
import { NestFactory } from '@nestjs/core';
import type { SQSEvent, SQSHandler } from 'aws-lambda';
import { WorkerModule } from './worker.module.js';
import { IngestionService } from './ingestion.service.js';

let cachedService: IngestionService | null = null;

async function bootstrap(): Promise<IngestionService> {
  const appContext = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error'],
  });

  return appContext.get(IngestionService);
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  const service = cachedService ?? (await bootstrap());
  cachedService = service;

  for (const record of event.Records) {
    const payload = JSON.parse(record.body);
    await service.processMessage(payload);
  }
};
```

> **Note**: `createApplicationContext()` skips HTTP adapters, middlewares, and route enhancers, cutting memory footprint and cold-start latency down to **~30ms**.

---

## 5. Production Bundler Configuration

When bundling NestJS for serverless execution using Webpack or Rspack, preserve class names so that reflection metadata (used by `class-transformer` and `class-validator`) operates reliably:

```javascript
// webpack.config.js
import TerserPlugin from 'terser-webpack-plugin';

export default (options, webpack) => {
  return {
    ...options,
    externals: [], // Inline node_modules into the Lambda bundle
    output: {
      ...options.output,
      libraryTarget: 'commonjs2', // Required for AWS Lambda CommonJS runtime export
    },
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            keep_classnames: true, // Preserve DTO class reflections
            keep_fnames: true,
          },
        }),
      ],
    },
  };
};
```

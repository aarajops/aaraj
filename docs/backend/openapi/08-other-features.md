# Advanced OpenAPI Features & Multi-Docs

> **Domain**: Multi-Specification Partitioning, Global Contracts & Static Schema Export  
> **Source Reference**: [NestJS OpenAPI Other Features](https://docs.nestjs.com/openapi/other-features)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

As enterprise systems grow, exposing every endpoint in a single massive Swagger document becomes unwieldy. NestJS provides advanced features to partition API documentation across domains, enforce global request parameters and responses, coordinate multi-specification dropdown explorers, and export static specifications for CI/CD pipelines.

---

## 1. Global Prefix Control

If your application configures a global prefix (e.g. `app.setGlobalPrefix('api/v1')`), Swagger includes this prefix in all generated path URLs by default. To strip the prefix from documentation:

```typescript
const document = SwaggerModule.createDocument(app, config, {
  ignoreGlobalPrefix: true,
});
```

---

## 2. Global Parameters & Global Responses

Instead of manually annotating common headers or standard 500 error responses across dozens of controllers, configure them once on the `DocumentBuilder`:

```typescript
// apps/api/src/main.ts
import { DocumentBuilder } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Enterprise API')
  .setVersion('1.0.0')
  // Automatically attaches 'X-Tenant-ID' header parameter to every documented route:
  .addGlobalParameters({
    name: 'X-Tenant-ID',
    in: 'header',
    required: true,
    description: 'Multi-tenant organization identifier',
  })
  // Automatically documents 500 error on every endpoint:
  .addGlobalResponse({
    status: 500,
    description: 'Internal Server Error - Unexpected server malfunction',
  })
  .build();
```

---

## 3. Multiple Specifications Partitioning

In large organizations, public customer-facing APIs, private partner APIs, and internal administrative backends should be partitioned into distinct documentation portals:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { AdminModule } from './admin/admin.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Customer Public API Specification
  const publicConfig = new DocumentBuilder()
    .setTitle('Customer API')
    .setDescription('Public customer-facing catalog and authentication')
    .setVersion('1.0.0')
    .addTag('public')
    .build();

  const publicDocFactory = () =>
    SwaggerModule.createDocument(app, publicConfig, {
      include: [AuthModule, CatalogModule],
    });
  SwaggerModule.setup('docs/public', app, publicDocFactory);

  // 2. Internal Admin API Specification
  const adminConfig = new DocumentBuilder()
    .setTitle('Admin Platform API')
    .setDescription('Internal platform administration and metrics')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('admin')
    .build();

  const adminDocFactory = () =>
    SwaggerModule.createDocument(app, adminConfig, {
      include: [AdminModule],
    });
  SwaggerModule.setup('docs/admin', app, adminDocFactory);

  await app.listen(process.env.PORT ?? 3001);
}

await bootstrap();
```

- Accessing `http://localhost:3001/docs/public` displays only `AuthModule` and `CatalogModule`.
- Accessing `http://localhost:3001/docs/admin` displays only `AdminModule`.

---

## 4. Swagger Explorer Dropdown Configuration

To present a unified portal where developers can switch between different service specifications using a dropdown menu in the top bar:

```typescript
// apps/api/src/main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const mainConfig = new DocumentBuilder()
  .setTitle('Araz Unified Gateway')
  .setVersion('1.0.0')
  .build();

const mainDoc = SwaggerModule.createDocument(app, mainConfig);

SwaggerModule.setup('api/docs', app, mainDoc, {
  explorer: true,
  swaggerOptions: {
    urls: [
      { name: '1. Core Gateway API', url: '/api/docs/swagger.json' },
      { name: '2. Catalog Service', url: '/api/docs/catalog/swagger.json' },
      { name: '3. Admin Service', url: '/api/docs/admin/swagger.json' },
    ],
  },
  jsonDocumentUrl: '/api/docs/swagger.json',
});
```

---

## 5. Headless Static File Export (CI/CD Pipelines)

In automated build pipelines, you often need to generate `openapi.json` or `openapi.yaml` without starting a live HTTP server, e.g. for linting via Spectral or generating frontend TypeScript SDKs:

```typescript
// scripts/export-openapi.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../apps/api/src/app.module.js';

async function exportOpenApi() {
  // Create headless application context without listening on a port
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Araz Enterprise API')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outputPath = resolve(process.cwd(), 'openapi.json');

  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf8');
  console.log(`OpenAPI specification successfully exported to: ${outputPath}`);

  await app.close();
}

await exportOpenApi();
```

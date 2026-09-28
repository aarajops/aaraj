# OpenAPI Introduction & Bootstrap

> **Domain**: API Contract Design & Interactive Documentation  
> **Source Reference**: [NestJS OpenAPI Introduction](https://docs.nestjs.com/openapi/introduction)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

The [OpenAPI](https://swagger.io/specification/) specification is a language-agnostic definition format for describing RESTful APIs. NestJS provides the official `@nestjs/swagger` module, which automatically inspects route handlers, DTO classes, and **Standard Schema** (Zod, Valibot) definitions to generate an interactive Swagger UI and valid OpenAPI v3.0 / v3.1 / v3.2 JSON and YAML documents.

---

## 1. Installation

Install `@nestjs/swagger` into your application:

```bash
pnpm add @nestjs/swagger
```

> [!WARNING]
> **Fastify Requirement**: If using `@nestjs/platform-fastify`, you must also install `@fastify/static` to enable serving the static Swagger UI HTML, JavaScript, and CSS bundle:
> ```bash
> pnpm add @fastify/static
> ```

---

## 2. Bootstrapping Swagger in `main.ts`

Initialize Swagger in your bootstrap file using `DocumentBuilder` and `SwaggerModule`:

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Build Base OpenAPI Configuration
  const config = new DocumentBuilder()
    .setTitle('Aaraj Enterprise API')
    .setDescription('Enterprise microservices and multi-tenant domain API')
    .setVersion('1.0.0')
    .addTag('auth', 'Authentication and session verification')
    .addTag('users', 'User account lifecycle operations')
    .addBearerAuth()
    .build();

  // 2. Wrap document creation in a deferred factory closure
  const documentFactory = () => SwaggerModule.createDocument(app, config);

  // 3. Mount Swagger UI at /api/docs
  SwaggerModule.setup('api/docs', app, documentFactory, {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  });

  await app.listen(process.env.PORT ?? 3001);
}

await bootstrap();
```

### Deferred Factory Closure (`documentFactory`)

Notice that `SwaggerModule.createDocument()` is passed to `SwaggerModule.setup()` as a closure (`() => SwaggerModule.createDocument(app, config)`). This defers document generation until a client first requests the documentation endpoint, significantly speeding up application startup time and avoiding blocking production container initialization.

> [!WARNING]
> **Versioning Order Precedence**: If you invoke `createDocument()` eagerly (without the factory function), ensure `app.enableVersioning()` is called **before** `createDocument()`. Otherwise, the generated endpoint paths will omit route version prefixes (e.g. `/v1/users`). The factory pattern is immune to this issue because document compilation is deferred until the HTTP server is already running.

---

## 3. Serving Schema Formats (JSON & YAML)

By default, Swagger UI exposes the raw OpenAPI document in JSON format at `<path>-json` (e.g., `http://localhost:3001/api/docs-json`).

You can customize the URLs or also expose YAML representations:

```typescript
SwaggerModule.setup('api/docs', app, documentFactory, {
  jsonDocumentUrl: 'api/docs/openapi.json',
  yamlDocumentUrl: 'api/docs/openapi.yaml',
});
```

Clients and code generators (e.g., Orval, OpenAPI Generator, Redoc) can now directly fetch the machine-readable schema at `http://localhost:3001/api/docs/openapi.json`.

---

## 4. Content Security Policy (CSP) & Security Headers

Swagger UI requires executing inline scripts and styles. If your application enforces Content Security Policy (CSP) via Helmet, you must adjust the directives to prevent the browser from blocking Swagger UI assets.

### Fastify Helmet Configuration

```typescript
import helmet from '@fastify/helmet';

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: [`'self'`],
      styleSrc: [`'self'`, `'unsafe-inline'`],
      imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
      scriptSrc: [`'self'`, `https:`, `'unsafe-inline'`],
    },
  },
});
```

---

## 5. `SwaggerDocumentOptions` Reference

Fine-tune OpenAPI generation by passing `SwaggerDocumentOptions` as the third parameter to `SwaggerModule.createDocument(app, config, options)`:

```typescript
export interface SwaggerDocumentOptions {
  /** Array of specific modules to include in the generated specification */
  include?: Function[];

  /** Additional model classes to inspect and include in components.schemas */
  extraModels?: Function[];

  /** If true, Swagger ignores the prefix set via app.setGlobalPrefix() */
  ignoreGlobalPrefix?: boolean;

  /** If true, recursively inspects routes from modules imported by 'include' modules */
  deepScanRoutes?: boolean;

  /** Custom operationId factory to format method identifiers */
  operationIdFactory?: (controllerKey: string, methodKey: string, version?: string) => string;

  /** Custom link name factory for response link objects */
  linkNameFactory?: (controllerKey: string, methodKey: string, fieldKey: string) => string;

  /** Auto-generates tags based on controller class name (default: true) */
  autoTagControllers?: boolean;

  /** If true, only documents endpoints annotated with @ApiIncludeEndpoint() */
  onlyIncludeDecoratedEndpoints?: boolean;

  /** If true, omits dynamic non-plain default values (e.g. new Date()) to keep schema deterministic */
  excludeDynamicDefaults?: boolean;

  /** Truncates nested example depths on schemas (default: undefined) */
  exampleMaxDepth?: number;

  /** Custom converter for Standard Schema instances */
  standardSchemaConverter?: StandardSchemaConverter;
}
```

### Custom `operationId` Factory

To generate concise, clean client SDK method names (e.g. `createUser` instead of `UsersController_createUser`):

```typescript
const options: SwaggerDocumentOptions = {
  operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
};

const documentFactory = () => SwaggerModule.createDocument(app, config, options);
```

---

## 6. Standard Schema Support (Zod, Valibot)

In NestJS 12, route parameter decorators natively accept [Standard Schema](https://standardschema.dev/) objects via the `schema` parameter:

```typescript
// apps/api/src/cats/cats.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

const createCatSchema = z.object({
  name: z.string().min(2),
  age: z.number().int().positive(),
  breed: z.string(),
});
type CreateCatDto = z.infer<typeof createCatSchema>;

@Controller('cats')
export class CatsController {
  @Post()
  create(@Body({ schema: createCatSchema }) createCatDto: CreateCatDto) {
    return { id: 1, ...createCatDto };
  }
}
```

`SwaggerModule` automatically detects these schemas and converts them into OpenAPI request bodies and query parameters.

### Native Standard JSON Schema

If your validation library implements the **Standard JSON Schema** extension (`~standard.jsonSchema`), Nest performs the conversion automatically without extra configuration. For example, **Zod 4.2+** natively supports this extension.

### Custom Schema Converters (`standardSchemaConverter`)

For schema libraries without native JSON schema emission (or when customizing schema translation), supply a `standardSchemaConverter` in `SwaggerDocumentOptions`.

#### 1. Zod Converter with `zod-openapi`

```bash
pnpm add -D zod-openapi
```

```typescript
import { SwaggerDocumentOptions, SwaggerModule } from '@nestjs/swagger';
import { createSchema } from 'zod-openapi';

const documentOptions: SwaggerDocumentOptions = {
  standardSchemaConverter: (schema, { schemaType }) => {
    const converted = createSchema(schema as never, {
      io: schemaType, // 'input' or 'output'
      openapiVersion: '3.0.0',
    });
    return { schema: converted.schema, components: converted.components };
  },
};
```

#### 2. Multi-Vendor Converter (Supporting Zod & Valibot Concurrently)

Every Standard Schema exposes its library vendor identifier at `~standard.vendor`. You can safely branch to support multiple schema libraries:

```typescript
import { SwaggerDocumentOptions } from '@nestjs/swagger';
import { toJsonSchema } from '@valibot/to-json-schema';
import { createSchema } from 'zod-openapi';

function hasVendor(schema: unknown, vendor: string): boolean {
  return (
    !!schema &&
    typeof schema === 'object' &&
    (schema as { '~standard'?: { vendor?: string } })['~standard']?.vendor === vendor
  );
}

const documentOptions: SwaggerDocumentOptions = {
  standardSchemaConverter: (schema, { schemaType }) => {
    if (hasVendor(schema, 'zod')) {
      const converted = createSchema(schema as never, {
        io: schemaType,
        openapiVersion: '3.0.0',
      });
      return { schema: converted.schema, components: converted.components };
    }

    if (hasVendor(schema, 'valibot')) {
      return {
        schema: toJsonSchema(schema as never, {
          target: 'openapi-3.0',
          typeMode: schemaType,
        }),
      };
    }

    return undefined; // Fall back to native NestJS conversion
  },
};
```

---

## 7. `SwaggerCustomOptions` Reference

Customize the Swagger UI appearance, assets, and behavior via `SwaggerCustomOptions`:

```typescript
export interface SwaggerCustomOptions {
  /** If true, Swagger resources are prefixed with global prefix (default: false) */
  useGlobalPrefix?: boolean;

  /** If false, disables Swagger UI but keeps raw JSON/YAML definitions accessible (default: true) */
  ui?: boolean;

  /** If true, serves both JSON and YAML. Or specify formats: ['json'] (default: true) */
  raw?: boolean | Array<'json' | 'yaml'>;

  /** Custom path to expose JSON document (default: '<path>-json') */
  jsonDocumentUrl?: string;

  /** Custom path to expose YAML document (default: '<path>-yaml') */
  yamlDocumentUrl?: string;

  /** Hook allowing transformation of the OpenAPI object prior to serving */
  patchDocumentOnRequest?: <TReq = any, TRes = any>(
    req: TReq,
    res: TRes,
    document: OpenAPIObject,
  ) => OpenAPIObject | Promise<OpenAPIObject>;

  /** Displays definition selector dropdown in top bar (default: false) */
  explorer?: boolean;

  /** Custom CSS stylesheets to inject */
  customCssUrl?: string | string[];

  /** Custom JavaScript scripts to inject */
  customJs?: string | string[];

  /** Custom page title for Swagger UI */
  customSiteTitle?: string;

  /** Custom favicon URL */
  customfavIcon?: string;
}
```

### Disabling UI While Exposing Headless JSON Definitions

In production environments, you can disable the Swagger UI while maintaining machine-readable JSON definitions for API gateways or client SDK generators:

```typescript
SwaggerModule.setup('api/docs', app, documentFactory, {
  ui: false, // Disables interactive HTML UI
  raw: ['json'], // Keeps /api/docs-json live
});
```

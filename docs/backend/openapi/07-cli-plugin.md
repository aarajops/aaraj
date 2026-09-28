# OpenAPI CLI Compiler Plugin

> **Domain**: AST Transformation, Automated Schema Inference & JSDoc Introspection  
> **Source Reference**: [NestJS OpenAPI CLI Plugin](https://docs.nestjs.com/openapi/cli-plugin)  
> **Compiler Target**: `tsc` / `swc` / `rspack`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

TypeScript's runtime metadata reflection (`reflect-metadata`) has fundamental limitations: it cannot determine property names inside a class, distinguish whether a property is required or optional, or extract JSDoc comments.

The **NestJS Swagger CLI Plugin** overcomes these limitations by inspecting your code at compile time using an **Abstract Syntax Tree (AST)** transformer. It automatically generates OpenAPI metadata on the fly, eliminating repetitive decorator boilerplate.

---

## 1. What the Plugin Automates

When the plugin is enabled:
- **Automatic Property Decoration**: Annotates every DTO property with `@ApiProperty()`, unless `@ApiHideProperty()` is explicitly declared.
- **Optionality Detection**: Inspects the TypeScript question mark (`name?: string`) and sets `required: false`.
- **Type & Array Inference**: Infers primitives, classes, arrays, and enums from TypeScript type annotations.
- **Default Values**: Extracts assigned default values (`isEnabled: boolean = true` -> `default: true`).
- **`class-validator` Shim**: Translates validation decorators (e.g., `@Max(10)`, `@MinLength(3)`) into OpenAPI schema rules (`maximum: 10`, `minLength: 3`).
- **JSDoc Introspection**: Extracts JSDoc comments, `@remarks`, `@example`, `@deprecated`, and `@throws` tags into OpenAPI summaries, descriptions, and examples.
- **`@param` Route Parameter Documentation**: Extracts controller `@param` JSDoc tags and assigns them as descriptions for `@Query()` and `@Param()` parameters.

```typescript
// WITHOUT PLUGIN (Tedious Manual Duplication)
export class CreateUserDto {
  @ApiProperty({ description: 'User email address', example: 'dev@aaraj.io' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ default: true })
  isEnabled?: boolean = true;
}

// WITH PLUGIN (Clean, Idiomatic TypeScript)
export class CreateUserDto {
  /**
   * User email address
   * @example 'dev@aaraj.io'
   */
  @IsEmail()
  email!: string;

  isEnabled?: boolean = true;
}
```

---

## 2. Configuration in `nest-cli.json`

To enable the plugin, configure `compilerOptions.plugins` in `nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true,
          "autoFillEnumName": true
        }
      }
    ]
  }
}
```

---

## 3. Plugin Options Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `dtoFileNameSuffix` | `string[]` | `['.dto.ts', '.entity.ts']` | Filename suffixes that the plugin inspects for DTO schemas. |
| `controllerFileNameSuffix` | `string[]` | `['.controller.ts']` | Filename suffixes that the plugin inspects for controllers. |
| `classValidatorShim` | `boolean` | `true` | Translates `class-validator` decorators into OpenAPI schema constraints. |
| `classTransformerShim` | `boolean` \| `'exclusive'` | `false` | Skips `@Exclude()` properties; `'exclusive'` only documents `@Expose()`. |
| `dtoKeyOfComment` | `string` | `'description'` | Property key to assign comment text to on `@ApiProperty`. |
| `controllerKeyOfComment` | `string` | `'summary'` | Property key to assign comment text to on `@ApiOperation`. |
| `introspectComments` | `boolean` | `false` | Enables extracting descriptions and examples from JSDoc comments. |
| `skipAutoHttpCode` | `boolean` | `false` | Disables automatic addition of `@HttpCode()` in controllers. |
| `skipDefaultValues` | `boolean` | `false` | Disables extracting initializers as schema `default` values. |
| `autoFillEnumName` | `boolean` | `false` | Automatically sets `enumName` to the TypeScript enum identifier. |
| `esmCompatible` | `boolean` | Auto-detected | Guarantees compatibility with pure ESM emitted files. |

---

## 4. JSDoc Introspection & Route Parameter Matching

When `introspectComments: true` is configured, JSDoc tags on controller methods automatically populate operation documentation:

```typescript
// apps/api/src/cats/cats.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatEntity } from './entities/cat.entity.js';

@Controller('cats')
export class CatsController {
  /**
   * Search registered feline catalog
   *
   * @remarks Retrieves paginated feline records filtered by breed and age.
   *
   * @param breed Filter catalog by pedigree breed
   * @param limit Maximum number of records to return
   * @throws {400} Invalid query parameter format
   */
  @Get()
  findAll(
    @Query('breed') breed?: string,
    @Query('limit') limit?: number,
  ): Promise<CatEntity[]> {
    return Promise.resolve([]);
  }
}
```

### Parameter Name Matching Rule

In NestJS 12, `@param` JSDoc descriptions are matched against the **variable identifier** in the method signature:
- For `@Query('sort_by') sortBy: string`, document it as `@param sortBy ...` (matching the TypeScript parameter name).
- Explicit decorators like `@ApiQuery({ description: '...' })` always take precedence over JSDoc comments.

---

## 5. SWC Builder Integration

When compiling with the SWC builder (`--builder swc`), compiler plugins require specific configuration:

### Standard Mode Setup

Enable type checking during build or watch execution:

```bash
nest start --builder swc --type-check
```

### Monorepo Setup (Serialized Metadata Generator)

For massive monorepos where SWC runs in pure transpilation mode, generate serialized metadata ahead of time:

```typescript
// apps/api/src/generate-metadata.ts
import { PluginMetadataGenerator } from '@nestjs/cli/lib/compiler/plugins/index.js';

const generator = new PluginMetadataGenerator();
generator.generate({
  visitors: [new (await import('@nestjs/swagger/dist/plugin/index.js')).ReadonlyVisitor({ introspectComments: true })],
  outputDir: './src',
  filename: 'metadata.ts',
  tsconfigPath: './tsconfig.app.json',
});
```

Load the generated metadata inside `main.ts` prior to creating the OpenAPI document:

```typescript
// apps/api/src/main.ts
import metadata from './metadata.js';

await SwaggerModule.loadPluginMetadata(metadata);
const document = SwaggerModule.createDocument(app, config);
```

---

## 6. Integration with Test Runners (`ts-jest` / Vitest)

Test runners often compile source code on the fly in memory without invoking the Nest CLI compiler. To ensure OpenAPI AST transformations apply during e2e tests:

### Jest (`jest-e2e.json`)

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "transform": {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        "astTransformers": {
          "before": ["@nestjs/swagger/plugin"]
        }
      }
    ]
  }
}
```

> [!TIP]
> If Jest fails to reflect DTO changes after updating schema annotations, clear the in-memory cache:
> ```bash
> npx jest --clearCache
> ```

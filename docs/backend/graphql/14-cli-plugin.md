# 14 - GraphQL CLI Compiler Plugin

> **Source Reference**: [NestJS Official Documentation - CLI Plugin](https://docs.nestjs.com/graphql/cli-plugin)

> [!NOTE]
> The CLI compiler plugin applies exclusively to the **Code First** approach.

TypeScript's reflection system (`reflect-metadata`) has inherent limitations: it cannot inspect property types that are interfaces, detect optional properties (marked with `?`), or extract comments at runtime. Developers are normally forced to manually duplicate type definitions and nullability in `@Field()` decorators.

The `@nestjs/graphql` CLI compiler plugin operates as an **Abstract Syntax Tree (AST) transformer** during compilation. It automatically scans your classes, generates `@Field()` decorators on the fly, detects nullability from the question mark token, and generates documentation directly from JSDoc comments.

---

## 1. Automated Boilerplate Reduction

Without the plugin, a model requires verbose decorator duplication:

```typescript
// WITHOUT PLUGIN: Repetitive, manual decorator boilerplate
@ObjectType()
export class Author {
  @Field(() => ID)
  id: number;

  @Field({ nullable: true, description: 'First name of the author' })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field(() => [Post])
  posts: Post[];
}
```

With the CLI plugin enabled, the exact same schema is generated from standard TypeScript definitions:

```typescript
// WITH PLUGIN: Clean, concise TypeScript
@ObjectType()
export class Author {
  @Field(() => ID) // Explicit override only when ambiguous
  id: number;

  /** First name of the author */
  firstName?: string; // Automatically marked nullable: true
  lastName?: string;
  posts: Post[];      // Automatically inferred as [Post]
}
```

---

## 2. Configuration in `nest-cli.json`

Enable the plugin in your project's `nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": [
      {
        "name": "@nestjs/graphql",
        "options": {
          "typeFileNameSuffix": [".input.ts", ".args.ts", ".entity.ts", ".model.ts"],
          "introspectComments": true,
          "esmCompatible": true
        }
      }
    ]
  }
}
```

### Plugin Options Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `typeFileNameSuffix` | `string[]` | `['.input.ts', '.args.ts', '.entity.ts', '.model.ts']` | Filename suffixes indicating files containing GraphQL classes to transform. |
| `introspectComments` | `boolean` | `false` | When `true`, transforms JSDoc comments into GraphQL field descriptions. |
| `esmCompatible` | `boolean` | `inferred` | Ensures emitted code is 100% pure ESM compliant (appends extensions, omits `require()`). |
| `debug` | `boolean` | `false` | Emits compiler diagnostics when types cannot be resolved. |

---

## 3. High-Performance SWC Compilation

When compiling with SWC rather than standard `tsc`, AST plugins run beforehand using the `PluginMetadataGenerator` to output a static metadata file:

```typescript
// scripts/generate-metadata.ts
import { PluginMetadataGenerator } from '@nestjs/cli/lib/compiler/plugins/index.js';
import { ReadonlyVisitor } from '@nestjs/graphql/dist/plugin/index.js';

const generator = new PluginMetadataGenerator();
generator.generate({
  visitors: [new ReadonlyVisitor({ introspectComments: true, esmCompatible: true })],
  outputDir: 'src',
  filename: 'metadata.ts',
  tsconfigPath: 'tsconfig.json',
});
```

Pass the generated metadata directly to `GraphQLModule`:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import metadata from './metadata.js'; // Auto-generated metadata table

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      metadata,
    }),
  ],
})
export class AppModule {}
```

# 15 - Generating GraphQL SDL

> **Source Reference**: [NestJS Official Documentation - Generating SDL](https://docs.nestjs.com/graphql/generating-sdl)

> [!NOTE]
> Headless schema extraction is an exclusive feature of the **Code First** approach.

In enterprise Continuous Integration (CI) and schema-checking pipelines, you often need to generate the static GraphQL Schema Definition Language (`schema.gql`) file without launching the entire application (which would attempt to connect to production databases, Redis caches, or external microservices).

`@nestjs/graphql` provides the `GraphQLSchemaBuilderModule` and `GraphQLSchemaFactory` to compile the schema headlessly.

---

## 1. Headless Generation Script

Create a standalone compilation script (e.g. `scripts/generate-sdl.ts`):

```typescript
import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { printSchema } from 'graphql';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Import all resolvers across feature modules
import { AuthorsResolver } from '../src/authors/authors.resolver.js';
import { PostsResolver } from '../src/posts/posts.resolver.js';
import { DateScalar } from '../src/common/scalars/date.scalar.js';

async function generateSchema() {
  // Bootstrap minimal headless context containing only the schema builder
  const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
  await app.init();

  const gqlSchemaFactory = app.get(GraphQLSchemaFactory);

  // Compile schema from resolvers and custom scalars
  const schema = await gqlSchemaFactory.create(
    [AuthorsResolver, PostsResolver],
    [DateScalar],
    {
      skipCheck: false,   // Validate schema integrity
      orphanedTypes: [],  // Include detached types
    },
  );

  const sdl = printSchema(schema);
  const outputPath = join(process.cwd(), 'schema.gql');

  writeFileSync(outputPath, sdl, 'utf-8');
  console.log(`[GraphQL SDL Generator] Successfully emitted schema to: ${outputPath}`);

  await app.close();
}

void generateSchema();
```

---

## 2. Options Reference

The `gqlSchemaFactory.create()` method accepts:

1. **Resolvers**: Array of resolver class references (`[AuthorsResolver, PostsResolver]`).
2. **Scalars** (Optional): Array of custom scalar class references (`[DateScalar, UuidScalar]`).
3. **Build Options** (Optional):
   - **`skipCheck`**: When `true`, suppresses schema validation warnings. Default is `false`.
   - **`orphanedTypes`**: Array of classes decorated with `@ObjectType()` that are not explicitly returned by any query or field resolver, but must be present in the emitted schema (e.g. subgraphs or external types).

---

## 3. Integration into `package.json`

Add a dedicated script to run schema extraction in CI:

```json
{
  "scripts": {
    "schema:generate": "node --loader tsx scripts/generate-sdl.ts",
    "schema:check": "graphql-inspector diff schema.gql"
  }
}
```

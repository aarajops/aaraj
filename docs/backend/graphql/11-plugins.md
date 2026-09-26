# 11 - GraphQL Server Plugins

> **Source Reference**: [NestJS Official Documentation - Plugins](https://docs.nestjs.com/graphql/plugins)

Plugins extend GraphQL server execution by intercepting phases of the operation lifecycle (request parsing, validation, execution, response delivery) and server initialization events.

---

## 1. Custom Apollo Server Plugins

To create an Apollo plugin, annotate a class with `@Plugin()` and implement `ApolloServerPlugin`:

```typescript
import { Plugin } from '@nestjs/apollo';
import type {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';

@Plugin()
export class LoggingPlugin implements ApolloServerPlugin {
  async requestDidStart(
    requestContext: GraphQLRequestContext<any>,
  ): Promise<GraphQLRequestListener<any>> {
    const start = performance.now();
    const { operationName, query } = requestContext.request;

    return {
      async willSendResponse() {
        const duration = (performance.now() - start).toFixed(2);
        console.log(`[GraphQL Operation] ${operationName ?? 'anonymous'} finished in ${duration}ms`);
      },
      async didEncounterErrors(rc) {
        console.error(`[GraphQL Error] In ${operationName}:`, rc.errors);
      },
    };
  }
}
```

Register the plugin as a provider in your module; NestJS discovers it and passes it to Apollo Server automatically:

```typescript
import { Module } from '@nestjs/common';
import { LoggingPlugin } from './logging.plugin.js';

@Module({
  providers: [LoggingPlugin],
})
export class CommonModule {}
```

---

## 2. External Apollo Plugins

Apollo Server provides official plugins for cache control, schema reporting, and inline tracing:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginCacheControl } from '@apollo/server/plugin/cacheControl';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      plugins: [
        ApolloServerPluginCacheControl({ defaultMaxAge: 10 }),
      ],
    }),
  ],
})
export class AppModule {}
```

---

## 3. Mercurius Plugins

For the `@nestjs/mercurius` driver, Fastify plugins can be passed via the `plugins` array:

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, type MercuriusDriverConfig } from '@nestjs/mercurius';
import cachePlugin from 'mercurius-cache';

@Module({
  imports: [
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: true,
      plugins: [
        {
          plugin: cachePlugin,
          options: {
            ttl: 30,
            policy: {
              Query: {
                users: true,
              },
            },
          },
        },
      ],
    }),
  ],
})
export class AppModule {}
```

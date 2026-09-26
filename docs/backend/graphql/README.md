# NestJS GraphQL Architecture & Engineering Standards

> **Domain**: Type-Safe Data Graphs, Resolvers, Subscriptions & Apollo Federation  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/graphql` v14+)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

GraphQL is a query language and runtime for APIs that empowers clients to request exactly the data they require—eliminating over-fetching and under-fetching while providing a strongly-typed schema contract.

NestJS provides a dedicated, enterprise-grade integration via `@nestjs/graphql`, supporting both **Apollo Server v5** (via `@nestjs/apollo`) and **Mercurius** (via `@nestjs/mercurius` on Fastify). It unifies GraphQL schema execution with the core NestJS architectural pillars: Dependency Injection, Guards, Interceptors, Pipes, Exception Filters, and Observability.

```text
                                INCOMING GRAPHQL QUERY
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Apollo Server v5 / Mercurius Ingress│
                      │  • GraphiQL IDE / Landing Page        │
                      │  • Context Factory ({ req, res })     │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │          Complexity Plugin            │
                      │  (Estimates Cost & Rejects DoS Trees) │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │       NestJS Request Enhancers        │
                      │  (GqlExecutionContext: Guards/Pipes)  │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │        Top-Level Query / Mutation     │
                      │  (@Query(), @Mutation(), @Args())     │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │        Field Middleware & Resolvers   │
                      │  (@ResolveField(), @Parent(), Cache)  │
                      └───────────────────────────────────────┘
```

---

## 1. Paradigm Comparison: Code First vs. Schema First

NestJS offers two distinct development paradigms for authoring GraphQL APIs:

| Dimension | Code First (Recommended) | Schema First |
| :--- | :--- | :--- |
| **Source of Truth** | TypeScript classes decorated with `@ObjectType()`, `@InputType()`, `@ArgsType()`. | GraphQL Schema Definition Language (`.graphql` / SDL files). |
| **Schema Generation** | Automatically emitted to a `.gql` file (`autoSchemaFile`) or generated dynamically in memory. | Hand-written SDL parsed at runtime via `typePaths: ['./**/*.graphql']`. |
| **Typing Safety** | End-to-end TypeScript types drive the schema; full type inference with zero code generation drift. | Requires `GraphQLDefinitionsFactory` compilation step to generate TypeScript definitions. |
| **Validation** | Directly annotates classes with `class-validator` or Standard Schema Zod contracts. | Requires subclassing generated types to apply runtime decorators. |
| **CLI Optimization** | Accelerated via `@nestjs/graphql/plugin` (AST transformer for automatic `@Field()` generation). | Not applicable. |

---

## 2. Driver Comparison: Apollo Server vs. Mercurius

| Feature | Apollo Driver (`@nestjs/apollo`) | Mercurius Driver (`@nestjs/mercurius`) |
| :--- | :--- | :--- |
| **Underlying Engine** | [Apollo Server v5](https://www.apollographql.com/) (`@apollo/server`). | [Mercurius](https://mercurius.dev/) (Fastify native plugin). |
| **Default HTTP Adapter** | Express (`@as-integrations/express5`) or Fastify. | Strictly Fastify (`FastifyAdapter`). |
| **Performance Profile** | Industry standard, feature-rich plugin ecosystem. | Ultra-high throughput, low latency JIT schema compilation. |
| **Federation Support** | Apollo Federation 1 & Federation 2 (`ApolloFederationDriver`, `@apollo/subgraph`). | Federation 1 supported; partial Federation 2 support. |
| **Subscriptions** | `graphql-ws` over WebSockets. | Fastify WebSocket integration (`mqemitter` / Redis). |
| **Default IDE** | GraphiQL (default) or Apollo Sandbox. | GraphiQL. |

---

## 3. GraphQL Documentation Index

Explore the 18 comprehensive deep-dive guides covering every aspect of `@nestjs/graphql`:

1. **[01 - Quick Start](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/01-quick-start.md)**: Driver installations, Apollo v5 setup, Mercurius integration, GraphiQL IDE configuration, request context factories, async options, and multi-endpoint scoping.
2. **[02 - Resolvers](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/02-resolvers.md)**: Code-first object types, `@Resolver()`, `@Query()`, `@ResolveField()`, `@Parent()`, `@Args()`, `@ArgsType()`, class inheritance, generics, and cursor-based pagination.
3. **[03 - Mutations](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/03-mutations.md)**: State modifications, `@Mutation()`, dedicated `@InputType()` arguments, and schema-first mutation mapping.
4. **[04 - Subscriptions](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/04-subscriptions.md)**: Real-time event streams via `graphql-ws`, `@Subscription()`, `PubSub` providers, event filtering, payload mutation, and WebSocket authentication.
5. **[05 - Scalars](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/05-scalars.md)**: Built-in primitive types, date scalar modes, custom scalars (`@Scalar()`, `CustomScalar<T, K>`), and external scalar bundles (`graphql-type-json`).
6. **[06 - Directives](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/06-directives.md)**: Custom schema directives, `@Directive()`, schema transformation via `mapSchema` (`@graphql-tools/utils`), and AST declarations.
7. **[07 - Interfaces](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/07-interfaces.md)**: Abstract polymorphic types, `@InterfaceType()`, `implements`, custom `resolveType()`, and interface resolver inheritance (`inheritResolversFromInterfaces`).
8. **[08 - Unions and Enums](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/08-unions-and-enums.md)**: Disjoint return types with `createUnionType()` (`as const`), `registerEnumType()`, value mappings, and deprecation metadata.
9. **[09 - Field Middleware](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/09-field-middleware.md)**: Intercepting field resolution, `FieldMiddleware`, `MiddlewareContext`, `NextFn`, global vs. local middleware, and execution sequencing.
10. **[10 - Mapped Types](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/10-mapped-types.md)**: DTO transformation utilities (`PartialType()`, `PickType()`, `OmitType()`, `IntersectionType()`), decorator target overrides, and composition.
11. **[11 - Plugins](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/11-plugins.md)**: Apollo Server lifecycle plugins (`@Plugin()`, `ApolloServerPlugin`), request tracing, cache-control headers, and Mercurius plugins.
12. **[12 - Complexity](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/12-complexity.md)**: Query complexity analysis via `graphql-query-complexity`, `ComplexityPlugin`, field-level cost estimators, and DoS mitigation.
13. **[13 - Extensions](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/13-extensions.md)**: Attaching arbitrary metadata via `@Extensions()`, field-level authorization, and custom permissions middleware.
14. **[14 - CLI Plugin](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/14-cli-plugin.md)**: Compiler AST transformer in `nest-cli.json`, automatic field inference, comments introspection, ESM output, and SWC metadata generator.
15. **[15 - Generating SDL](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/15-generating-sdl.md)**: Headless schema extraction via `GraphQLSchemaBuilderModule` and `GraphQLSchemaFactory` for CI/CD schema artifact generation.
16. **[16 - Sharing Models](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/16-sharing-models.md)**: Reusing code-first backend models in browser bundles via `graphql-model-shim` to strip server-side decorators.
17. **[17 - Other Features](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/17-other-features.md)**: `GqlExecutionContext`, `GqlArgumentsHost`, guards, interceptors, pipes, custom param decorators (`@User()`), field-level enhancers, and custom drivers.
18. **[18 - Federation](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/graphql/18-federation.md)**: Microservice supergraphs, Apollo Federation 1 & 2 (`ApolloFederationDriver`, `@apollo/subgraph`), `@key`, `@extends`, `@external`, `@link`, `@ResolveReference()`, and gateway routing.

---

## 4. Production Engineering Checklist

- [ ] **Disable In-Browser IDE in Production**: Ensure `graphiql: false` in production environments (`NODE_ENV=production`) to prevent public introspection of schema internals.
- [ ] **Enforce Query Complexity & Depth Limits**: Integrate `graphql-query-complexity` to calculate operation costs and reject recursive or deeply nested queries before resolver execution.
- [ ] **Modern WebSocket Protocol**: Use `graphql-ws` exclusively for subscriptions. Do not use deprecated `subscriptions-transport-ws`.
- [ ] **Field Resolver Enhancers Caution**: Only enable `fieldResolverEnhancers` when strictly necessary; running interceptors on thousands of array elements introduces significant CPU latency.
- [ ] **Pure ESM Compatibility**: Ensure all relative imports in schema definitions and resolvers utilize explicit `.js` extensions for Node.js `NodeNext` compliance.
- [ ] **Input Validation**: Couple `@Args()` or `@InputType()` with `ValidationPipe` or Standard Schema Zod pipes to enforce contract validation before resolvers run.

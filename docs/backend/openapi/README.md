# NestJS OpenAPI (Swagger) Architecture Standards

> **Domain**: API Contract Design, Interactive Documentation & Schema Generation  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/swagger` v12+)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

The [OpenAPI](https://swagger.io/specification/) specification is the vendor-neutral standard for describing RESTful HTTP APIs. NestJS provides the official `@nestjs/swagger` module, enabling automated generation of OpenAPI 3.0, 3.1, and 3.2 specifications directly from TypeScript source code, decorators, AST compiler transforms, and **Standard Schema** (Zod, Valibot) definitions.

```text
                           NESTJS OPENAPI PIPELINE
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   ┌──────────────────────┐                       ┌──────────────────────┐
   │  TypeScript DTOs &   │                       │   Standard Schema    │
   │   Route Handlers     │                       │    (Zod / Valibot)   │
   │ • @Body(), @Query()  │                       │ • Body({ schema })   │
   │ • @ApiProperty()     │                       │ • ~standard.jsonSchema│
   └──────────┬───────────┘                       └───────────┬──────────┘
              │                                               │
              ├───────────────────────┬───────────────────────┤
              ▼                       ▼                       ▼
   ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
   │ AST Compiler Plugin │ │ Custom Converters   │ │ Explicit Decorators │
   │ • Type inference    │ │ • zod-openapi       │ │ • @ApiTags()        │
   │ • JSDoc comments    │ │ • @valibot/to-json  │ │ • @ApiResponse()    │
   └──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │     DocumentBuilder     │
                         │ • Titles & Descriptions │
                         │ • Security Schemes      │
                         │ • OpenAPI 3.2 Tags      │
                         └────────────┬────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   documentFactory ()    │
                         │ • createDocument(app)   │
                         │ • Deferred JIT Build    │
                         └────────────┬────────────┘
                                      ▼
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   ┌──────────────────────┐                       ┌──────────────────────┐
   │  Swagger UI Mount    │                       │ Schema Distribution  │
   │ • SwaggerModule.setup│                       │ • /api-json          │
   │ • Explorer dropdown  │                       │ • /api-yaml          │
   │ • Custom JS / CSS    │                       │ • Static File Export │
   └──────────────────────┘                       └──────────────────────┘
```

---

## 1. Core Architectural Capabilities

- **Zero-Boilerplate AST Transformation**: The Nest CLI compiler plugin (`@nestjs/swagger`) inspects TypeScript types and JSDoc comments at compile time, eliminating repetitive `@ApiProperty()` annotations across DTOs.
- **Native Standard Schema Support**: In NestJS 12, route parameters typed with Zod (v4.2+) or Valibot via `@Body({ schema })` are automatically ingested into the OpenAPI document using the standard JSON schema specification (`~standard.jsonSchema`).
- **Deferred Document Generation**: Wrapping document creation in a factory closure (`documentFactory = () => SwaggerModule.createDocument(app, config)`) ensures OpenAPI metadata is generated JIT on the first client request rather than blocking initial application bootstrap.
- **Multi-Platform Support**: Works seamlessly across both Express and Fastify (with `@fastify/static`), accommodating Content Security Policy (CSP) headers without breaking Swagger UI assets.
- **Multi-Specification Orchestration**: Partition monolithic API documentation into isolated, domain-bounded portals (e.g. `/api/customers`, `/api/admin`, `/api/internal`) unified through the Swagger Explorer dropdown.

---

## 2. Platform Adapter Considerations (Express vs. Fastify)

| Consideration | Express (`@nestjs/platform-express`) | Fastify (`@nestjs/platform-fastify`) |
| :--- | :--- | :--- |
| **Static Asset Driver** | Bundled by default via `serve-static`. | Requires explicit installation of `@fastify/static`. |
| **Security Headers (CSP)** | Default Nest security headers allow Swagger UI. | Fastify `helmet` directives block Swagger scripts unless customized. |
| **Route Prefix Handling** | Inherits `setGlobalPrefix()` cleanly. | Requires `useGlobalPrefix: true` when mounting Swagger at sub-paths. |
| **Bootstrap Performance** | Standard Node.js HTTP overhead. | Low-overhead routing with high-throughput specification delivery. |

---

## 3. OpenAPI Documentation Suite Index

Explore the 8 comprehensive guides covering the complete NestJS OpenAPI implementation lifecycle:

1. **[01 - OpenAPI Introduction & Bootstrap](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/01-introduction.md)**: Module installation, deferred `documentFactory` bootstrap, Fastify `@fastify/static` rules, Content Security Policy (CSP) tuning, complete `SwaggerDocumentOptions`, and **Standard Schema (Zod / Valibot)** integration.
2. **[02 - Types, Parameters & Schemas](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/02-types-and-parameters.md)**: DTO reflection, `@ApiProperty()`, arrays, circular references, enums with `enumName` to prevent client generation duplication, raw matrix definitions, `@ApiExtraModels()`, and polymorphic schemas (`oneOf`, `anyOf`, `allOf`).
3. **[03 - Operations & Responses](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/03-operations.md)**: Route operations, OpenAPI 3.2 hierarchical tags (`parent`, `kind`), request headers, shorthand response decorators (`@ApiOkResponse`, `@ApiCreatedResponse`), multipart file uploads, and reusable generic paginated responses (`ApiPaginatedResponse`).
4. **[04 - Security Schemes & Authentication](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/04-security.md)**: Securing API operations with `@ApiSecurity()`, Basic Auth (`@ApiBasicAuth()`), JWT Bearer tokens (`@ApiBearerAuth()`), OAuth2 scopes (`@ApiOAuth2()`), and Cookie sessions (`@ApiCookieAuth()`).
5. **[05 - Mapped Types](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/05-mapped-types.md)**: DRY schema derivation using `@nestjs/swagger` mapped types: `PartialType()`, `PickType()`, `OmitType()`, `IntersectionType()`, and recursive composition.
6. **[06 - OpenAPI Decorators Reference](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/06-decorators.md)**: Exhaustive catalog of all 28+ `@Api*` decorators, their targets (Method, Controller, Model), and composition patterns.
7. **[07 - CLI Compiler Plugin](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/07-cli-plugin.md)**: Automatic `@ApiProperty()` generation, JSDoc comment introspection (`@remarks`, `@param`, `@example`), `PluginOptions` reference, SWC metadata integration, and Jest/Vitest e2e test configuration.
8. **[08 - Advanced Features & Multi-Docs](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/openapi/08-other-features.md)**: Global parameters, global responses, multi-specification partitioning (`include: [Module]`), Swagger Explorer dropdown orchestration, and headless static JSON/YAML file generation for CI/CD pipelines.

---

## 4. Enterprise Best Practices & Production Checklist

- [ ] **Use the Factory Pattern for Document Creation**: Always wrap `SwaggerModule.createDocument()` in a closure (`() => SwaggerModule.createDocument(...)`) passed to `SwaggerModule.setup()` to prevent expensive document generation from slowing down cold boot times.
- [ ] **Enable the CLI Compiler Plugin**: Configure `"plugins": ["@nestjs/swagger"]` in `nest-cli.json` with `introspectComments: true` to avoid duplicating descriptions and example values between TypeScript types, JSDoc comments, and decorators.
- [ ] **Assign `enumName` to All Enums**: Always specify `enumName: 'MyEnum'` when decorating enums with `@ApiProperty()` to ensure Swagger hoists the enum into `components.schemas`, avoiding duplicate types in client SDK generators (e.g. NSwag, Orval, OpenAPI Generator).
- [ ] **Import Mapped Types from `@nestjs/swagger`**: Never import `PartialType` or `OmitType` from `@nestjs/mapped-types` inside DTOs; only `@nestjs/swagger` mapped types emit OpenAPI schema metadata.
- [ ] **Register Polymorphic & Generic Models via `@ApiExtraModels`**: Whenever a schema is combined via `allOf`, `oneOf`, or `anyOf` and is not directly referenced as a controller return type, register it with `@ApiExtraModels()` to guarantee inclusion in the OpenAPI document.
- [ ] **Harden Content Security Policy (CSP)**: If running behind Fastify with Helmet, ensure `'unsafe-inline'` and `validator.swagger.io` are allowed in CSP directives, or serve Swagger UI only in non-production environments.

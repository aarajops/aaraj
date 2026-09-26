# Official Sample Catalog & Architectural Archetypes

> **Domain**: Reference Implementations, Official Repositories & Architectural Blueprints  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Source Repository**: [NestJS Official Samples](https://github.com/nestjs/nest/tree/master/sample)

The official NestJS sample repository maintains authoritative, runnable reference implementations demonstrating architectural patterns across HTTP, microservices, databases, GraphQL, real-time protocols, and tooling.

---

## 1. Core HTTP & Platform Engines

| Directory / Sample | Core Technologies | Focus / Pattern |
| :--- | :--- | :--- |
| `01-cats-app` | Express / TypeScript | Classic starter architecture demonstrating Controllers, Services, Pipes, and DTOs. |
| `02-gateways` | WebSockets / Socket.IO | Real-time event subscription, rooms, and WebSocket Gateway lifecycle. |
| `03-microservices` | TCP Transporter | Microservice client-server communication using `@MessagePattern` and `ClientProxy`. |
| `08-webpack` | Webpack HMR | Stateful Hot-Module Replacement using `module.hot.dispose` and `closePromise`. |
| `10-fastify` | Fastify Adapter | High-performance Fastify integration with route handlers and plugin mounting. |
| `17-mvc` | Express / Handlebars | Server-side rendering (SSR) using Model-View-Controller patterns and template engines. |
| `24-serve-static` | `@nestjs/serve-static` | Hosting Single-Page Applications (SPA) with client-side fallback to `index.html`. |

---

## 2. Microservices & Event Meshes

| Directory / Sample | Message Broker | Focus / Pattern |
| :--- | :--- | :--- |
| `11-nats` | NATS | High-speed messaging, wildcards, request-reply, and event publishing. |
| `12-graphql-schema-first` | GraphQL / Mercurius | Schema-first GraphQL SDL definition with automated TypeScript generation. |
| `13-mongo-typeorm` | MongoDB / TypeORM | Document persistence with TypeORM repository patterns. |
| `14-mongoose` | MongoDB / Mongoose | Schema definitions, Mongoose models, and document validation. |
| `16-gateways-ws` | `ws` (Engine) | Pure standards-compliant WebSockets without Socket.IO protocol overhead. |
| `19-auth-jwt` | Passport / JWT | Stateless JWT authentication, Bearer tokens, and `@UseGuards(JwtAuthGuard)`. |

---

## 3. Advanced Recipes & Production Patterns

Beyond the root sample directory, the NestJS organization maintains dedicated standalone repository blueprints for complex enterprise domains:

* **[nest-cqrs-example](https://github.com/kamilmysliwiec/nest-cqrs-example)**: Production-grade CQRS architecture featuring `CommandBus`, `QueryBus`, `EventBus`, and RxJS Sagas.
* **[nest-vitest](https://github.com/TrilonIO/nest-vitest)**: Ultra-fast Vitest unit and E2E testing configured with `unplugin-swc` and path aliases.
* **[nest-commander](https://github.com/jmcdo29/nest-commander)**: Enterprise command-line CLI toolkits using NestJS dependency injection.
* **[terminus](https://github.com/nestjs/terminus/tree/master/sample)**: Production health checks with database, disk, memory, and graceful shutdown orchestration.

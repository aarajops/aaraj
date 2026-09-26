# Serving Static Assets & Client SPAs

> **Domain**: Single-Page Application (SPA) Hosting, Static File Delivery & Caching  
> **Source Reference**: [NestJS Serve Static Recipe](https://docs.nestjs.com/recipes/serve-static)  
> **Package**: `@nestjs/serve-static`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

When shipping full-stack services where the NestJS backend also serves a client Single-Page Application (React, Vue, Vite, or Angular), the `@nestjs/serve-static` module coordinates static asset delivery and SPA client-side routing fallbacks.

---

## 1. Installation

Install `@nestjs/serve-static`:

```bash
pnpm add @nestjs/serve-static
```

---

## 2. Bootstrapping in `AppModule`

Import and configure `ServeStaticModule.forRoot()`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // Path pointing to built client bundle (e.g. dist/client or apps/web/dist)
      rootPath: join(import.meta.dirname, '..', '..', 'web', 'dist'),
      serveRoot: '/',               // Root URL path to mount assets
      exclude: ['/api/(.*)'],       // Exclude backend API routes from static fallback
      serveStaticOptions: {
        cacheControl: true,
        maxAge: 86400000,           // 1 day cache in production
        etag: true,
      },
    }),
  ],
})
export class AppModule {}
```

---

## 3. SPA Client-Side Routing Fallback

In modern Single-Page Applications, routing is handled on the client (e.g. React Router). When a user navigates directly to `http://mysite.com/dashboard/settings`:
1. By default, `renderPath` matches all non-API paths and serves the root `index.html` file with a `200 OK` status.
2. The browser loads the frontend bundle, and the client-side router mounts the appropriate `/dashboard/settings` component.
3. Server routes registered via controllers (e.g. `GET /api/v1/users`) take precedence over the static asset handler.

---

## 4. Fastify Adapter Compatibility

> [!WARNING]
> When using `@nestjs/platform-fastify`, Fastify's static handler returns a `404 Not Found` for routes that do not match a physical file on disk by default. To enable Express-like SPA fallback behavior, explicitly set `fallthrough: true` inside `serveStaticOptions`:

```typescript
ServeStaticModule.forRoot({
  rootPath: join(import.meta.dirname, '..', 'client'),
  serveStaticOptions: {
    fallthrough: true, // Mandatory for Fastify SPA route fallbacks
  },
})
```

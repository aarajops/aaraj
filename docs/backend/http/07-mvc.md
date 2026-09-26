# 07 - Model-View-Controller (MVC)

> **Source Reference**: [NestJS Official Documentation - Model-View-Controller](https://docs.nestjs.com/http/mvc)

The Model-View-Controller (MVC) architectural pattern separates data models, business logic (controllers), and user presentation (views). While modern single-page applications (like `@araz/web` built on Next.js) decouple frontend presentation, NestJS provides native support for server-side HTML rendering using template engines like **Handlebars (`hbs`)**, **EJS**, or **Pug**.

---

## 1. Express MVC Implementation (`hbs`)

### Installation

```bash
pnpm --filter @araz/api add hbs
```

### Application Bootstrapping (`NestExpressApplication`)

To expose platform-specific methods like `setBaseViewsDir()`, type the application instance as **`NestExpressApplication`**:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static assets (CSS, JS, images) from public/
  app.useStaticAssets(join(process.cwd(), 'public'), {
    prefix: '/static/',
  });

  // Configure views directory and Handlebars engine
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

---

## 2. Views & Static Template Rendering

### Defining the Template (`views/index.hbs`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{ title }}</title>
    <link rel="stylesheet" href="/static/css/styles.css" />
  </head>
  <body>
    <main>
      <h1>{{ message }}</h1>
      <p>Server-side rendered at {{ timestamp }}</p>
    </main>
  </body>
</html>
```

### Controller with `@Render()`

The `@Render()` decorator specifies which template to render. The object returned by the controller handler is passed directly into the template context:

```typescript
// src/app.controller.ts
import { Controller, Get, Render } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Render('index')
  root() {
    return {
      title: 'Araz Platform',
      message: 'Welcome to the Araz Application Portal',
      timestamp: new Date().toLocaleTimeString(),
    };
  }
}
```

---

## 3. Adding Shared Layouts

Layouts allow defining a standard HTML wrapper (navigation, headers, footers) into which individual view templates are injected.

### Configuring Default Layout

Set the `layout` local property on Express:

```typescript
// src/main.ts
app.setLocal('layout', 'layouts/main');
```

### Creating Layout Template (`views/layouts/main.hbs`)

Use triple curly braces `{{{body}}}` to inject unescaped page content:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Araz Portal</title>
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
        <a href="/status">System Status</a>
      </nav>
    </header>

    <div class="content-wrapper">
      {{{body}}}
    </div>

    <footer>
      <p>&copy; 2026 Araz Inc. All rights reserved.</p>
    </footer>
  </body>
</html>
```

---

## 4. Dynamic View Selection with `@Res()`

When business logic dictates which template to render at runtime (e.g. rendering `mobile-dashboard` vs `desktop-dashboard`), inject the platform response:

```typescript
// src/dashboard/dashboard.controller.ts
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

@Controller('dashboard')
export class DashboardController {
  @Get()
  renderDashboard(@Req() req: Request, @Res() res: Response) {
    const isMobile = req.headers['user-agent']?.includes('Mobile');
    const viewName = isMobile ? 'dashboard/mobile' : 'dashboard/desktop';

    return res.render(viewName, {
      user: 'Administrator',
      analyticsReady: true,
    });
  }
}
```

---

## 5. Fastify MVC Implementation

To run MVC views under Fastify, install Fastify-specific static and view plugins:

```bash
pnpm --filter @araz/api add @fastify/static @fastify/view handlebars
```

### Fastify Bootstrap Configuration

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import Handlebars from 'handlebars';
import { join } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.useStaticAssets({
    root: join(process.cwd(), 'public'),
    prefix: '/public/',
  });

  app.setViewEngine({
    engine: {
      handlebars: Handlebars,
    },
    templates: join(process.cwd(), 'views'),
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
```

> [!WARNING]
> **Fastify `@Render()` File Extension Requirement**:
> Unlike Express which automatically resolves the view file extension configured in `app.setViewEngine()`, Fastify **requires explicit file extensions** in the `@Render()` decorator:
> ```typescript
> @Get()
> @Render('index.hbs') // Note the mandatory .hbs extension!
> root() {
>   return { message: 'Hello Fastify MVC' };
> }
> ```

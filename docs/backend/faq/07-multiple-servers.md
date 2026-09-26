# HTTPS Configuration & Multiple Simultaneous Ports

> **Domain**: Transport Layer Security (TLS), Multi-Port Binding & Socket Teardown  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In modern microservice architectures, TLS termination is commonly offloaded to ingress proxies (Nginx, AWS ALB, Envoy). However, in direct-to-container environments, internal compliance requirements, or development sandboxes, NestJS can terminate HTTPS directly.

Additionally, certain applications must listen on **multiple network ports simultaneously** (e.g., serving cleartext HTTP on port 80 with an automatic redirect to HTTPS on port 443, or running administrative metrics on an isolated internal port).

---

## 1. Single HTTPS Server Configuration

Pass the TLS certificate and private key in `httpsOptions` during application bootstrap:

### Express Adapter

```typescript
import { NestFactory } from '@nestjs/core';
import * as fs from 'node:fs';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('./secrets/private-key.pem'),
    cert: fs.readFileSync('./secrets/public-cert.pem'),
  };

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });

  await app.listen(443);
}
await bootstrap();
```

### Fastify Adapter

Pass the `https` configuration directly into the `FastifyAdapter` constructor:

```typescript
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as fs from 'node:fs';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('./secrets/private-key.pem'),
    cert: fs.readFileSync('./secrets/public-cert.pem'),
  };

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ https: httpsOptions }),
  );

  await app.listen(443, '0.0.0.0');
}
await bootstrap();
```

---

## 2. Binding Multiple Simultaneous Ports (HTTP + HTTPS)

When hosting multiple ports from a single NestJS application context (e.g., HTTP on 3000 and HTTPS on 443), instantiate the underlying engine (Express) manually and pass it to `ExpressAdapter`:

```typescript
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import { AppModule } from './app.module.js';
import { ShutdownObserver } from './shutdown-observer.service.js';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('./secrets/private-key.pem'),
    cert: fs.readFileSync('./secrets/public-cert.pem'),
  };

  // 1. Create native Express instance
  const server = express();

  // 2. Wrap within NestJS ExpressAdapter
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  await app.init();

  // 3. Create independent Node.js HTTP and HTTPS listeners
  const httpServer = http.createServer(server).listen(3000);
  const httpsServer = https.createServer(httpsOptions, server).listen(443);

  // 4. Register listeners with custom ShutdownObserver for graceful teardown
  const shutdownObserver = app.get(ShutdownObserver);
  shutdownObserver.addHttpServer(httpServer);
  shutdownObserver.addHttpServer(httpsServer);

  app.enableShutdownHooks();
}
await bootstrap();
```

---

## 3. Graceful Multi-Server Teardown (`ShutdownObserver`)

Because the `http.Server` instances were instantiated manually rather than managed directly by NestFactory, invoking `app.close()` will **not** terminate them. Implement an `OnApplicationShutdown` observer to gracefully release both ports:

```typescript
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type * as http from 'node:http';

@Injectable()
export class ShutdownObserver implements OnApplicationShutdown {
  private readonly httpServers: http.Server[] = [];

  addHttpServer(server: http.Server): void {
    this.httpServers.push(server);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.httpServers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          }),
      ),
    );
  }
}
```

> **Warning**: Dual-port architectures instantiated via manual HTTP/HTTPS servers are **incompatible with GraphQL subscriptions** (which require a single authoritative WebSocket server attached to the primary HTTP transport).

# Keep-Alive Connections & Socket Teardown

> **Domain**: Socket Lifecycle, Connection Pooling & Graceful Server Shutdown  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

By default, modern HTTP clients (browsers, reverse proxies, and microservice HTTP connection pools) utilize `Connection: Keep-Alive` headers to reuse persistent TCP sockets across multiple request/response cycles.

While Keep-Alive improves network throughput by eliminating TLS handshake latency, it introduces severe operational issues during server shutdown and live development: the Node.js HTTP server waits indefinitely for open client sockets to close naturally, preventing `app.close()` from terminating the process.

---

## 1. Symptoms of Dangling Keep-Alive Sockets

1. **Development `--watch` Hangs & `EADDRINUSE`**: During watch mode reloads, the previous process instance cannot release the TCP port because an open browser tab or background polling request maintains an active keep-alive socket.
2. **Kubernetes Deployment Timeouts**: When Kubernetes issues a `SIGTERM` during a rolling release, pods get stuck in `Terminating` until killed by `SIGKILL` (after `terminationGracePeriodSeconds`), potentially dropping in-flight traffic.

---

## 2. Enabling `forceCloseConnections`

NestJS provides the `forceCloseConnections` option to forcibly destroy idle and persistent keep-alive connections when `app.close()` or `app.enableShutdownHooks()` is invoked.

### Express Adapter Configuration

In `@nestjs/platform-express`, configure `forceCloseConnections` directly in the `NestApplicationOptions`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    forceCloseConnections: true, // Forcibly destroy keep-alive sockets on shutdown
  });

  // Enable lifecycle shutdown hooks for SIGTERM / SIGINT
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

### Fastify Adapter Configuration

In `@nestjs/platform-fastify`, pass `forceCloseConnections` directly to the `FastifyAdapter` constructor, which forwards the configuration to the underlying Fastify server instance:

```typescript
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    forceCloseConnections: true, // Configured on the Fastify instance directly
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
```

---

## 3. Graceful Socket Teardown Lifecycle

When `forceCloseConnections: true` is enabled, the shutdown progression proceeds as follows:

```text
[Incoming SIGTERM]
       │
       ▼
1. app.close() Invoked
       │
       ▼
2. HTTP Server Stops Accepting New Connections (server.close())
       │
       ▼
3. In-flight HTTP Requests Given Opportunity to Complete
       │
       ▼
4. Remaining Idle / Active Keep-Alive Sockets Forcibly Destroyed (socket.destroy())
       │
       ▼
5. TCP Port Released Immediately (Prevents EADDRINUSE)
       │
       ▼
6. Process Exits Cleanly
```

---

## 4. Production Architectural Recommendations

- **Behind Load Balancers (AWS ALB / Nginx / Cloudflare)**: Set your server's keep-alive timeout higher than the load balancer's keep-alive timeout (`keepAliveTimeout > 60s`) to prevent race conditions where Node.js closes a socket just as the load balancer sends a new request (resulting in `502 Bad Gateway`).
- **Container Deployments**: Pair `forceCloseConnections: true` with [Terminus Graceful Shutdown](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/recipes/07-health-checks.md#graceful-shutdown-timeout) (`gracefulShutdownTimeoutMs: 5000`) so ingress controllers have time to deregister the pod before sockets are severed.

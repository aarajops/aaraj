# 05 - Compression

> **Source Reference**: [NestJS Official Documentation - Compression](https://docs.nestjs.com/http/compression)

HTTP response compression reduces payload sizes transmitted across the wire, decreasing network transit time, improving **Largest Contentful Paint (LCP)**, and slashing bandwidth costs. Clients declare supported encodings using the `Accept-Encoding` header, and the server applies the optimal algorithm (Brotli, Gzip, Deflate, or Zstandard).

---

## 1. Architectural Strategy: In-App vs. Reverse Proxy Offloading

> [!IMPORTANT]
> **Production Recommendation**:
> Compression is heavily CPU-bound. In **high-traffic production environments**, compression should be offloaded to an edge CDN (Cloudflare, AWS CloudFront) or reverse proxy (Nginx, Envoy, Traefik). This preserves Node.js single-threaded event loop resources for application business logic.
>
> In-app compression middleware is ideal for:
> - Direct-to-client deployments without dedicated ingress proxies
> - Development, staging, and internal microservice-to-microservice communication
> - Environments where end-to-end compression is required inside an encrypted VPC

---

## 2. Express Compression (`compression`)

### Installation

```bash
pnpm --filter @aaraj/api add compression
pnpm --filter @aaraj/api add -D @types/compression
```

### Configuration & Thresholds

Apply the middleware globally in `main.ts`. Configure a `threshold` to prevent wasting CPU cycles attempting to compress tiny payloads that would expand due to header overhead:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    compression({
      // Only compress responses that exceed 1 KB
      threshold: 1024,
      // Custom filter to skip already compressed media formats
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6, // Balanced gzip compression level (1-9)
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

---

## 3. Fastify Compression (`@fastify/compress`)

The `FastifyAdapter` utilizes `@fastify/compress`, which natively supports modern encodings including **Brotli (`br`)** and **Zstandard (`zstd`)**.

### Installation

```bash
pnpm --filter @aaraj/api add @fastify/compress
```

### Registration & Brotli Quality Tuning

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import { constants } from 'node:zlib';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(compression, {
    // Brotli tuning: quality 4 delivers 85% of maximum compression at a fraction of CPU cost
    brotliOptions: {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 4,
      },
    },
    // Threshold below which responses are skipped
    threshold: 1024,
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
```

### Restricting Encodings for Lower CPU Overhead

If CPU efficiency is paramount and Brotli consumes too much CPU, restrict Fastify to Gzip and Deflate:

```typescript
await app.register(compression, {
  encodings: ['gzip', 'deflate'],
});
```

---

## 4. Encoding Algorithm Comparison

| Algorithm | HTTP Token | Compression Ratio | CPU Overhead | Recommended Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Brotli** | `br` | Highest (~15-25% smaller than Gzip) | Medium-High (at quality 4-6) | Text assets, large JSON payloads, static files |
| **Gzip** | `gzip` | Balanced standard | Low-Medium | Universal fallback, high-throughput microservices |
| **Zstandard** | `zstd` | Very High | Ultra-Low | Supported Node.js runtimes and modern browsers |
| **Deflate** | `deflate` | Moderate | Very Low | Legacy fallback |

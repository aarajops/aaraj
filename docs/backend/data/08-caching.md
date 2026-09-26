# 08 - Caching & Distributed Stores

> **Source Reference**: [NestJS Official Documentation - Caching](https://docs.nestjs.com/data/caching)

Caching is an essential performance optimization pattern in backend systems. A cache acts as a temporary, high-speed storage layer that provides sub-millisecond access to frequently queried data, reducing expensive database queries and CPU-intensive computations.

NestJS provides the `@nestjs/cache-manager` package, built on top of [cache-manager](https://github.com/j-nordberg/node-cache-manager) and powered by [Keyv](https://keyv.org/). It supports both local in-memory storage and distributed backends like Redis.

---

## 1. Installation & Module Setup

```bash
# In-memory caching:
pnpm --filter @araz/api add @nestjs/cache-manager cache-manager

# Distributed Redis caching:
pnpm --filter @araz/api add @keyv/redis cacheable
```

### Basic Setup in `AppModule`

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register({
      isGlobal: true, // CacheManager available across all modules
      ttl: 60000,     // Default TTL: 60 seconds (in milliseconds)
    }),
  ],
})
export class AppModule {}
```

---

## 2. Programmatic Cache Interaction (`CACHE_MANAGER`)

Inject the `Cache` client using the `CACHE_MANAGER` injection token:

```typescript
// src/products/products.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export interface Product {
  id: string;
  name: string;
  price: number;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getProduct(id: string): Promise<Product> {
    const cacheKey = `product:${id}`;

    // 1. Check cache: returns undefined on cache miss
    const cached = await this.cacheManager.get<Product>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for key: ${cacheKey}`);
      return cached;
    }

    this.logger.debug(`Cache MISS for key: ${cacheKey}`);

    // 2. Fetch from primary database:
    const product = await this.fetchFromDatabase(id);

    // 3. Store in cache with 5-minute TTL (300,000 ms):
    await this.cacheManager.set(cacheKey, product, 300_000);

    return product;
  }

  async invalidateProduct(id: string): Promise<void> {
    const cacheKey = `product:${id}`;
    await this.cacheManager.del(cacheKey);
    this.logger.log(`Invalidated cache for key: ${cacheKey}`);
  }

  async flushAll(): Promise<void> {
    await this.cacheManager.clear();
  }

  private async fetchFromDatabase(id: string): Promise<Product> {
    return { id, name: 'Araz Enterprise License', price: 999 };
  }
}
```

> **Data Serialization Warning**: Keyv serializes cached values to JSON. Class instances come back as plain JavaScript objects, `Date` objects become ISO strings, and functions or symbols cannot be cached.

---

## 3. Automatic Response Caching (`CacheInterceptor`)

To cache full HTTP responses automatically without manual `get` and `set` calls, bind `CacheInterceptor`:

### Controller / Handler Level Caching

```typescript
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';

@Controller('catalogs')
@UseInterceptors(CacheInterceptor)
export class CatalogsController {
  // Uses automatically generated URL cache key
  @Get()
  @CacheTTL(120_000) // 2 minutes TTL
  getCatalog() {
    return [{ id: 'cat_1', name: 'Software Products' }];
  }

  // Uses explicit custom cache key
  @Get('featured')
  @CacheKey('featured_products_v1')
  @CacheTTL(600_000) // 10 minutes TTL
  getFeatured() {
    return [{ id: 'prod_99', name: 'Top Seller' }];
  }
}
```

### Global HTTP Response Caching

To cache all `GET` endpoints across the entire API, register `CacheInterceptor` as an `APP_INTERCEPTOR` multi-provider:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';

@Module({
  imports: [CacheModule.register({ isGlobal: true, ttl: 30_000 })],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
  ],
})
export class AppModule {}
```

> **Rules of `CacheInterceptor`**:
> 1. Only `GET` endpoints are cached (unless an explicit `@CacheKey()` is applied).
> 2. Handlers injecting the native response object (`@Res()`) **cannot** be cached.
> 3. GraphQL resolver fields cannot use `CacheInterceptor`.

---

## 4. Custom Cache Tracking (`trackBy`)

By default, the cache key is generated from the request URL (e.g. `/catalogs?page=2`). If responses vary based on HTTP headers (e.g. `Authorization`, `x-tenant-id`, or `Accept-Language`), subclass `CacheInterceptor` and override `trackBy()`:

```typescript
// src/common/interceptors/tenant-cache.interceptor.ts
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';

@Injectable()
export class TenantHttpCacheInterceptor extends CacheInterceptor {
  override trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.headers['x-tenant-id'] ?? 'public';
    const path = request.url;

    // Generates tenant-isolated cache key:
    return `tenant:${tenantId}:${path}`;
  }
}
```

---

## 5. Multi-Store Caching with Redis (`@keyv/redis`)

In high-scale deployments, use a multi-tier cache:
- **L1 Cache (In-Memory)**: Microsecond-speed cache on the local container.
- **L2 Cache (Distributed Redis)**: Shared cache across all container replicas.

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { Keyv } from 'keyv';
import { KeyvCacheableMemory } from 'cacheable';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUri = config.get<string>('REDIS_URL', 'redis://localhost:6379');

        return {
          stores: [
            // L1: In-memory LRU cache (1 minute TTL, max 5,000 items)
            new Keyv({
              store: new KeyvCacheableMemory({ ttl: 60_000, lruSize: 5000 }),
            }),
            // L2: Shared Redis instance
            createKeyv(redisUri),
          ],
        };
      },
    }),
  ],
})
export class AppModule {}
```

---

## 6. WebSockets and Microservices Caching

In WebSocket gateways and microservice message handlers, URLs do not exist. You **must** provide an explicit `@CacheKey()` for `CacheInterceptor` to function:

```typescript
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';

@WebSocketGateway()
export class EventsGateway {
  @SubscribeMessage('get_leaderboard')
  @UseInterceptors(CacheInterceptor)
  @CacheKey('ws:global_leaderboard')
  @CacheTTL(10_000)
  handleGetLeaderboard() {
    return [{ rank: 1, score: 9800 }];
  }
}
```

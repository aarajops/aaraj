import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, minutes } from "@nestjs/throttler";
import { getRedisClient } from "./platform/redis/redis-client.js";
import { ApiThrottlerGuard } from "./platform/redis/api-throttler.guard.js";
import { RedisThrottlerStorage } from "./platform/redis/redis-throttler.storage.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "./platform/authorization/authorization.module.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { RedisModule } from "./platform/redis/redis.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 120, ttl: minutes(1) }],
      storage: new RedisThrottlerStorage(getRedisClient()),
    }),
    AuditModule,
    AuthModule,
    PlatformAuthorizationModule,
    CatalogModule,
    InventoryModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule {}

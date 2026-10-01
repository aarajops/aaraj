import { Module } from "@nestjs/common";
import { CatalogModule } from "./catalog/catalog.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "./platform/authorization/authorization.module.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { RedisModule } from "./platform/redis/redis.module.js";

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    PlatformAuthorizationModule,
    CatalogModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

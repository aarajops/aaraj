import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import { StorefrontSettingsService } from "./storefront.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [StorefrontController],
  providers: [StorefrontSettingsService, StorefrontPolicy],
  exports: [StorefrontSettingsService],
})
export class StorefrontModule {}

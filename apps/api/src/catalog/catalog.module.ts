import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { CatalogService } from "./catalog.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogPolicy],
})
export class CatalogModule {}

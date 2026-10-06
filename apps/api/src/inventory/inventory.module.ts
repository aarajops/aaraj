import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryPolicy } from "./inventory.policy.js";
import { InventoryService } from "./inventory.service.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    CatalogModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryPolicy, InventoryService],
})
export class InventoryModule {}

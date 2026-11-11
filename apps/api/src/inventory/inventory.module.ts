import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryPolicy } from "./inventory.policy.js";
import { InventoryReservationService } from "./inventory-reservation.service.js";
import { INVENTORY_RESERVATION_PORT } from "./inventory-reservation.port.js";
import { INVENTORY_RETURN_PORT } from "./inventory-return.port.js";
import { InventoryService } from "./inventory.service.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    CatalogModule,
  ],
  controllers: [InventoryController],
  providers: [
    InventoryPolicy,
    InventoryService,
    InventoryReservationService,
    {
      provide: INVENTORY_RESERVATION_PORT,
      useExisting: InventoryReservationService,
    },
    {
      provide: INVENTORY_RETURN_PORT,
      useExisting: InventoryService,
    },
  ],
  exports: [INVENTORY_RESERVATION_PORT, INVENTORY_RETURN_PORT],
})
export class InventoryModule {}

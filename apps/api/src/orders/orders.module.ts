import { Module } from "@nestjs/common";
import { CartModule } from "../cart/cart.module.js";
import { GeographyModule } from "../geography/geography.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { AuditModule } from "../platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { QuoteModule } from "../quote/quote.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrderServiceabilityExpiryWorker } from "./order-serviceability-expiry.worker.js";
import { OrdersService } from "./orders.service.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    CartModule,
    QuoteModule,
    GeographyModule,
    InventoryModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderServiceabilityExpiryWorker],
})
export class OrdersModule {}

import { Module } from "@nestjs/common";
import { CartModule } from "../cart/cart.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { GeographyModule } from "../geography/geography.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { AuditModule } from "../platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { QuoteModule } from "../quote/quote.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { CheckoutDraftsService } from "./checkout-drafts.service.js";
import { CheckoutDraftsController } from "./checkout-drafts.controller.js";
import { CheckoutDraftCleanupWorker } from "./checkout-draft-cleanup.worker.js";
import { CustomersController } from "./customers.controller.js";
import { ORDERS_PATHAO_PORT } from "./orders-pathao.port.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    CartModule,
    CatalogModule,
    QuoteModule,
    GeographyModule,
    InventoryModule,
  ],
  controllers: [
    OrdersController,
    CheckoutDraftsController,
    CustomersController,
  ],
  providers: [
    OrdersService,
    CheckoutDraftsService,
    CheckoutDraftCleanupWorker,
    { provide: ORDERS_PATHAO_PORT, useExisting: OrdersService },
  ],
  exports: [ORDERS_PATHAO_PORT],
})
export class OrdersModule {}

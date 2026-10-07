import { Module } from "@nestjs/common";
import { CartModule } from "../cart/cart.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { DeliveryModule } from "../delivery/delivery.module.js";
import { GeographyModule } from "../geography/geography.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { TaxModule } from "../tax/tax.module.js";
import { QuoteController } from "./quote.controller.js";
import { QuoteService } from "./quote.service.js";

@Module({
  imports: [
    CartModule,
    CatalogModule,
    DeliveryModule,
    GeographyModule,
    DatabaseModule,
    TaxModule,
  ],
  controllers: [QuoteController],
  providers: [QuoteService],
})
export class QuoteModule {}

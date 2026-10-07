import { Module } from "@nestjs/common";
import { DatabaseModule } from "../platform/database/database.module.js";
import { DeliveryService } from "./delivery.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}

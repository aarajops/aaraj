import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DeliveryController } from "./delivery.controller.js";
import { DeliveryPolicy } from "./delivery.policy.js";
import { DeliveryService } from "./delivery.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryPolicy],
  exports: [DeliveryService],
})
export class DeliveryModule {}

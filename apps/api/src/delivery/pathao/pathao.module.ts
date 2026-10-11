import { Module } from "@nestjs/common";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { PlatformAuthorizationModule } from "../../platform/authorization/authorization.module.js";
import { OrdersModule } from "../../orders/orders.module.js";
import { DatabaseModule } from "../../platform/database/database.module.js";
import {
  PathaoCustomerTrackingController,
  PathaoManagementController,
  PathaoWebhookController,
} from "./pathao.controller.js";
import { PathaoApiClient } from "./pathao-api.client.js";
import { PathaoService } from "./pathao.service.js";
import { PathaoTokenService } from "./pathao-token.service.js";
import { PathaoWebhookWorker } from "./pathao-webhook.worker.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    OrdersModule,
  ],
  controllers: [
    PathaoManagementController,
    PathaoCustomerTrackingController,
    PathaoWebhookController,
  ],
  providers: [
    PathaoApiClient,
    PathaoTokenService,
    PathaoService,
    PathaoWebhookWorker,
  ],
})
export class PathaoModule {}

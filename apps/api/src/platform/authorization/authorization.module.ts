import { AuthorizationModule } from "@nestjs/authorization";
import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AccessController } from "./access.controller.js";
import { CookieMutationGuard } from "./cookie-mutation.guard.js";
import { AccessPolicy } from "./access.policy.js";
import { AccessService } from "./access.service.js";
import { AuditPolicy } from "./audit.policy.js";
import { AuthorizationDenialsLogger } from "./authorization-denials.logger.js";
import { PermissionsService } from "./permissions.service.js";
import { OrdersPolicy } from "./orders.policy.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthorizationModule.forRoot()],
  controllers: [AccessController],
  providers: [
    AuthorizationDenialsLogger,
    PermissionsService,
    AccessPolicy,
    AuditPolicy,
    OrdersPolicy,
    AccessService,
    CookieMutationGuard,
  ],
  exports: [PermissionsService, CookieMutationGuard],
})
export class PlatformAuthorizationModule {}

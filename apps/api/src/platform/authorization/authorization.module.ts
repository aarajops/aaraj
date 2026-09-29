import { AuthorizationModule } from "@nestjs/authorization";
import { Module } from "@nestjs/common";
import { AuthorizationDenialsLogger } from "./authorization-denials.logger.js";
import { DatabaseModule } from "../database/database.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { PermissionsService } from "./permissions.service.js";
import { AccessPolicy } from "./access.policy.js";
import { AccessService } from "./access.service.js";
import { AccessController } from "./access.controller.js";
import { AccessMutationGuard } from "./access-mutation.guard.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthorizationModule.forRoot()],
  controllers: [AccessController],
  providers: [
    AuthorizationDenialsLogger,
    PermissionsService,
    AccessPolicy,
    AccessService,
    AccessMutationGuard,
  ],
  exports: [PermissionsService],
})
export class PlatformAuthorizationModule {}

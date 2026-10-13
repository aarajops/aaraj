import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { TaxController } from "./tax.controller.js";
import { TaxPolicy } from "./tax.policy.js";
import { TaxService } from "./tax.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [TaxController],
  providers: [TaxService, TaxPolicy],
  exports: [TaxService],
})
export class TaxModule {}

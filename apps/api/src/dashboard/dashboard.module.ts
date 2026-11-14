import { Module } from "@nestjs/common";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  imports: [DatabaseModule, PlatformAuthorizationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

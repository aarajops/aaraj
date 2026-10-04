import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { CatalogService } from "./catalog.service.js";
import { CategoryController } from "./category.controller.js";
import { CategoryService } from "./category.service.js";
import { SizeGuideController } from "./size-guide.controller.js";
import { SizeGuideService } from "./size-guide.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [CatalogController, CategoryController, SizeGuideController],
  providers: [CatalogService, CatalogPolicy, CategoryService, SizeGuideService],
})
export class CatalogModule {}

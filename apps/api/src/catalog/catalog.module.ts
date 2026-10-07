import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { CatalogService } from "./catalog.service.js";
import { CATALOG_INVENTORY_PORT } from "./catalog-inventory.port.js";
import { CATALOG_CART_PORT } from "./catalog-cart.port.js";
import { CatalogInventoryReader } from "./catalog-inventory.reader.js";
import { CategoryController } from "./category.controller.js";
import { CategoryService } from "./category.service.js";
import { SizeGuideController } from "./size-guide.controller.js";
import { SizeGuideService } from "./size-guide.service.js";
import { CatalogMediaManageGuard } from "./media/catalog-media.guard.js";
import { CatalogMediaUploadLifecycleInterceptor } from "./media/catalog-media-upload-lifecycle.interceptor.js";
import { CatalogMediaService } from "./media/catalog-media.service.js";
import { CatalogMediaPublicController } from "./media/catalog-media-public.controller.js";
import { R2Storage } from "./media/r2-storage.js";

@Module({
  imports: [DatabaseModule, AuditModule, PlatformAuthorizationModule],
  controllers: [
    CatalogController,
    CatalogMediaPublicController,
    CategoryController,
    SizeGuideController,
  ],
  providers: [
    CatalogService,
    CatalogPolicy,
    CategoryService,
    SizeGuideService,
    CatalogMediaManageGuard,
    CatalogMediaUploadLifecycleInterceptor,
    CatalogMediaService,
    R2Storage,
    CatalogInventoryReader,
    {
      provide: CATALOG_INVENTORY_PORT,
      useExisting: CatalogInventoryReader,
    },
    {
      provide: CATALOG_CART_PORT,
      useExisting: CatalogService,
    },
  ],
  exports: [CATALOG_INVENTORY_PORT, CATALOG_CART_PORT],
})
export class CatalogModule {}

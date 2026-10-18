import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { StorageModule } from "../platform/storage/storage.module.js";
import { StorefrontBrandAssetService } from "./storefront-brand-asset.service.js";
import {
  StorefrontAssetManageGuard,
  StorefrontAssetUploadLifecycleInterceptor,
} from "./storefront-asset-upload.guard.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontBannersController } from "./storefront-banners.controller.js";
import { StorefrontBannersService } from "./storefront-banners.service.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import { StorefrontSettingsService } from "./storefront.service.js";

@Module({
  imports: [
    CatalogModule,
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    StorageModule,
  ],
  controllers: [StorefrontController, StorefrontBannersController],
  providers: [
    StorefrontSettingsService,
    StorefrontBrandAssetService,
    StorefrontBannersService,
    StorefrontAssetManageGuard,
    StorefrontAssetUploadLifecycleInterceptor,
    StorefrontPolicy,
  ],
  exports: [StorefrontSettingsService],
})
export class StorefrontModule {}

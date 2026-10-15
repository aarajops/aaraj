import { Module } from "@nestjs/common";
import { AuditModule } from "../platform/audit/audit.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { PlatformAuthorizationModule } from "../platform/authorization/authorization.module.js";
import { StorageModule } from "../platform/storage/storage.module.js";
import { StorefrontBrandAssetService } from "./storefront-brand-asset.service.js";
import {
  StorefrontBrandAssetManageGuard,
  StorefrontBrandAssetUploadLifecycleInterceptor,
} from "./storefront-brand-asset-upload.guard.js";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontPolicy } from "./storefront.policy.js";
import { StorefrontSettingsService } from "./storefront.service.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    PlatformAuthorizationModule,
    StorageModule,
  ],
  controllers: [StorefrontController],
  providers: [
    StorefrontSettingsService,
    StorefrontBrandAssetService,
    StorefrontBrandAssetManageGuard,
    StorefrontBrandAssetUploadLifecycleInterceptor,
    StorefrontPolicy,
  ],
  exports: [StorefrontSettingsService],
})
export class StorefrontModule {}

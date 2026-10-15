import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { finalize } from "rxjs";
import { PermissionsService } from "../platform/authorization/permissions.service.js";
import {
  setStorefrontBrandAssetUploadRelease,
  storefrontBrandAssetUploadRelease,
  type BrandAssetUploadRequest,
} from "./storefront-brand-asset.service.js";

const MAX_ACTIVE_BRAND_ASSET_UPLOADS = 2;

@Injectable()
export class StorefrontBrandAssetManageGuard implements CanActivate {
  private activeUploads = 0;

  constructor(private readonly permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<BrandAssetUploadRequest>();
    const user = request.session?.user;
    if (
      !(await this.permissions.has(user ?? null, "storefront.settings.manage"))
    ) {
      throw new ForbiddenException("Storefront settings access is required.");
    }
    if (this.activeUploads >= MAX_ACTIVE_BRAND_ASSET_UPLOADS) {
      throw new HttpException(
        {
          message: "Brand image upload capacity is busy. Retry shortly.",
          errorCode: "STOREFRONT_ASSET_UPLOAD_BUSY",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeUploads += 1;
    let released = false;
    setStorefrontBrandAssetUploadRelease(request, () => {
      if (released) return;
      released = true;
      this.activeUploads -= 1;
    });
    return true;
  }
}

@Injectable()
export class StorefrontBrandAssetUploadLifecycleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<BrandAssetUploadRequest>();
    return next
      .handle()
      .pipe(finalize(() => storefrontBrandAssetUploadRelease(request)?.()));
  }
}

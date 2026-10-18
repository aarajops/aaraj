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
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { PermissionsService } from "../platform/authorization/permissions.service.js";

const UPLOAD_RELEASE = Symbol("STOREFRONT_ASSET_UPLOAD_RELEASE");
const MAX_ACTIVE_UPLOADS_PER_PROCESS = 2;

export interface StorefrontAssetUploadRequest {
  session?: { user: AccessPrincipal };
  [UPLOAD_RELEASE]?: () => void;
}

export function storefrontAssetUploadRelease(
  request: StorefrontAssetUploadRequest,
): (() => void) | undefined {
  return request[UPLOAD_RELEASE];
}

function setUploadRelease(
  request: StorefrontAssetUploadRequest,
  release: () => void,
) {
  request[UPLOAD_RELEASE] = release;
}

@Injectable()
export class StorefrontAssetManageGuard implements CanActivate {
  private activeUploads = 0;

  constructor(private readonly permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<StorefrontAssetUploadRequest>();
    if (
      !(await this.permissions.has(
        request.session?.user ?? null,
        "storefront.settings.manage",
      ))
    ) {
      throw new ForbiddenException("Storefront settings access is required.");
    }
    if (this.activeUploads >= MAX_ACTIVE_UPLOADS_PER_PROCESS) {
      throw new HttpException(
        {
          message: "Storefront image upload capacity is busy. Retry shortly.",
          errorCode: "STOREFRONT_ASSET_UPLOAD_BUSY",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeUploads += 1;
    let released = false;
    setUploadRelease(request, () => {
      if (released) return;
      released = true;
      this.activeUploads -= 1;
    });
    return true;
  }
}

@Injectable()
export class StorefrontAssetUploadLifecycleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<StorefrontAssetUploadRequest>();
    return next
      .handle()
      .pipe(finalize(() => storefrontAssetUploadRelease(request)?.()));
  }
}

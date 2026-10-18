import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserSession } from "@thallesp/nestjs-better-auth";
import type { Request } from "express";
import {
  MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY,
  type Permission,
} from "@aaraj/contracts";
import { PermissionsService } from "../../platform/authorization/permissions.service.js";

export const CATALOG_MEDIA_UPLOAD_RELEASE = Symbol(
  "CATALOG_MEDIA_UPLOAD_RELEASE",
);
export const CATALOG_MEDIA_UPLOAD_PERMISSION = "catalogMediaUploadPermission";

export function RequireCatalogMediaUploadPermission(permission: Permission) {
  return SetMetadata(CATALOG_MEDIA_UPLOAD_PERMISSION, permission);
}

export type CatalogMediaUploadRequest = Request & {
  session?: UserSession;
  [CATALOG_MEDIA_UPLOAD_RELEASE]?: () => void;
};

// Multer buffers uploads in memory. Bound each API process to two 10 MiB
// sources at once; image decoding itself is serialized by the processor.
@Injectable()
export class CatalogMediaManageGuard implements CanActivate {
  private activeUploads = 0;

  constructor(
    private readonly permissions: PermissionsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<CatalogMediaUploadRequest>();
    const user = request.session?.user;
    const permission =
      this.reflector.get<Permission>(
        CATALOG_MEDIA_UPLOAD_PERMISSION,
        context.getHandler(),
      ) ?? "catalog.manage";
    if (!(await this.permissions.has(user ?? null, permission))) {
      throw new ForbiddenException("Catalog management access is required.");
    }

    if (this.activeUploads >= MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY) {
      throw new HttpException(
        {
          message: "Catalog media upload capacity is busy. Retry shortly.",
          errorCode: "CATALOG_MEDIA_UPLOAD_BUSY",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeUploads += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeUploads -= 1;
    };
    request[CATALOG_MEDIA_UPLOAD_RELEASE] = release;

    return true;
  }
}

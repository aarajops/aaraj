import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { UserSession } from "@thallesp/nestjs-better-auth";
import type { Request } from "express";
import { MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY } from "@aaraj/contracts";
import { PermissionsService } from "../../platform/authorization/permissions.service.js";

export const CATALOG_MEDIA_UPLOAD_RELEASE = Symbol(
  "CATALOG_MEDIA_UPLOAD_RELEASE",
);

export type CatalogMediaUploadRequest = Request & {
  session?: UserSession;
  [CATALOG_MEDIA_UPLOAD_RELEASE]?: () => void;
};

// Multer buffers uploads in memory. Bound each API process to two 10 MiB
// sources at once; image decoding itself is serialized by the processor.
@Injectable()
export class CatalogMediaManageGuard implements CanActivate {
  private activeUploads = 0;

  constructor(private readonly permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<CatalogMediaUploadRequest>();
    const user = request.session?.user;
    if (!(await this.permissions.has(user ?? null, "catalog.manage"))) {
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

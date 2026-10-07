import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { finalize, type Observable } from "rxjs";
import {
  CATALOG_MEDIA_UPLOAD_RELEASE,
  type CatalogMediaUploadRequest,
} from "./catalog-media.guard.js";

@Injectable()
export class CatalogMediaUploadLifecycleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<CatalogMediaUploadRequest>();
    return next
      .handle()
      .pipe(finalize(() => request[CATALOG_MEDIA_UPLOAD_RELEASE]?.()));
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class CookieMutationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const trustedOrigin =
      process.env.CLIENT_URL ??
      (process.env.NODE_ENV === "production"
        ? undefined
        : "http://localhost:3000");
    if (!trustedOrigin || request.headers.origin !== trustedOrigin) {
      throw new ForbiddenException(
        "The request origin could not be verified.",
        {
          errorCode: "UNTRUSTED_ORIGIN",
        },
      );
    }
    return true;
  }
}

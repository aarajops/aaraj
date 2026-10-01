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
    const request = context.switchToHttp().getRequest<
      Request & {
        session?: { session?: { createdAt?: Date | string } };
      }
    >();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    // Better Auth's CSRF checks cover its own endpoints, not Nest business writes.
    const trustedOrigin =
      process.env.CLIENT_URL ??
      (process.env.NODE_ENV === "production"
        ? undefined
        : "http://localhost:3000");
    if (!trustedOrigin || request.headers.origin !== trustedOrigin) {
      throw new ForbiddenException("A trusted Origin is required");
    }
    const createdAt = request.session?.session?.createdAt;
    const age = createdAt ? Date.now() - new Date(createdAt).getTime() : NaN;
    // A new password sign-in creates a new session. Session renewal does not reset createdAt.
    if (!Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) {
      throw new ForbiddenException({
        code: "RECENT_SIGN_IN_REQUIRED",
        message: "Sign in again before this action (within 15 minutes).",
      });
    }
    return true;
  }
}

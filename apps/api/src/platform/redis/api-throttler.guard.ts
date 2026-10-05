import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import type { ExecutionContext } from "@nestjs/common";

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    request: Record<string, any>,
  ): Promise<string> {
    const headerName = process.env.BETTER_AUTH_IP_ADDRESS_HEADER?.trim();
    const headerValue = headerName
      ? request.headers?.[headerName.toLowerCase()]
      : undefined;
    const ipAddress =
      typeof headerValue === "string" && isIP(headerValue.trim())
        ? headerValue.trim()
        : await super.getTracker(request);
    return createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(normalizeRateLimitAddress(ipAddress))
      .digest("hex");
  }

  protected override generateKey(
    context: ExecutionContext,
    suffix: string,
    throttlerName: string,
  ): string {
    const prefix = process.env.THROTTLER_REDIS_KEY_PREFIX ?? "aaraj:throttler:";
    return `${prefix}${super.generateKey(context, suffix, throttlerName)}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const response = this.getRequestResponse(context).res;
    const retryAfter = Math.ceil(
      detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire,
    );
    this.setResponseHeader(response, "Retry-After", retryAfter);
    await super.throwThrottlingException(context, detail);
  }
}

function normalizeRateLimitAddress(address: string): string {
  if (isIP(address) !== 6) return address;

  const [left = "", right = ""] = address.toLowerCase().split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const lastPart = rightParts.at(-1);
  if (lastPart?.includes(".")) {
    const octets = lastPart.split(".").map(Number);
    const upper = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const lower = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    rightParts.splice(-1, 1, upper.toString(16), lower.toString(16));
  }

  const missingParts = 8 - leftParts.length - rightParts.length;
  const parts = address.includes("::")
    ? [...leftParts, ...Array<string>(missingParts).fill("0"), ...rightParts]
    : leftParts;
  const normalized = parts.map((part) => Number.parseInt(part || "0", 16));
  if (
    normalized.slice(0, 5).every((part) => part === 0) &&
    normalized[5] === 0xffff
  ) {
    const upper = normalized[6] ?? 0;
    const lower = normalized[7] ?? 0;
    return [upper >> 8, upper & 255, lower >> 8, lower & 255].join(".");
  }
  return `${normalized
    .slice(0, 4)
    .map((part) => part.toString(16).padStart(4, "0"))
    .join(":")}/64`;
}

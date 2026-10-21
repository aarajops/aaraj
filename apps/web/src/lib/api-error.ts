import { ApiErrorResponseSchema } from "@aaraj/contracts";

export function getApiErrorMessage(body: unknown, fallback: string): string {
  const result = ApiErrorResponseSchema.safeParse(body);
  if (!result.success) return fallback;
  return Array.isArray(result.data.message)
    ? result.data.message.join(" ")
    : result.data.message;
}

import {
  ApiErrorResponseSchema,
  type ApiErrorResponse,
} from "@aaraj/contracts";

export async function readApiErrorResponse(
  response: Response,
): Promise<ApiErrorResponse | null> {
  try {
    const result = ApiErrorResponseSchema.safeParse(await response.json());
    return result.success && result.data.statusCode === response.status
      ? result.data
      : null;
  } catch {
    return null;
  }
}

export function getApiErrorMessage(
  problem: ApiErrorResponse | null,
): string | null {
  if (!problem) return null;
  const message = Array.isArray(problem.message)
    ? problem.message.join(" ")
    : problem.message;
  return message.trim() || null;
}

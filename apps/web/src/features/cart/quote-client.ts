import "client-only";

import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  AuthoritativeQuoteSchema,
  BangladeshGeographySchema,
  QuoteDestinationInputSchema,
  QuoteLookupSchema,
  type AuthoritativeQuote,
  type BangladeshGeography,
  type QuoteDestinationInput,
  type QuoteDestinationRef,
  type QuoteLookup,
} from "@aaraj/contracts";

export class QuoteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "QuoteRequestError";
  }
}

export async function fetchBangladeshGeography(): Promise<BangladeshGeography> {
  const response = await fetch(`${API_V1_BASE_PATH}/geography`, {
    cache: "force-cache",
    credentials: "same-origin",
  });
  return readResponse(response, BangladeshGeographySchema);
}

export async function requestQuote(
  input: QuoteDestinationInput,
): Promise<AuthoritativeQuote> {
  const validatedInput = QuoteDestinationInputSchema.parse(input);
  const response = await fetch(`${API_V1_BASE_PATH}/quotes`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validatedInput),
  });
  return readResponse(response, AuthoritativeQuoteSchema);
}

export async function fetchCurrentQuote(
  id: string,
): Promise<AuthoritativeQuote> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/quotes/${encodeURIComponent(id)}/current`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, AuthoritativeQuoteSchema);
}

export async function lookupQuote(
  id: string,
  destination: QuoteDestinationRef,
): Promise<QuoteLookup> {
  const query = new URLSearchParams({
    geographyVersion: destination.geographyVersion,
    divisionId: destination.divisionId,
    districtId: destination.districtId,
  });
  if (destination.upazilaId) query.set("upazilaId", destination.upazilaId);
  const response = await fetch(
    `${API_V1_BASE_PATH}/quotes/${encodeURIComponent(id)}?${query}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, QuoteLookupSchema);
}

async function readResponse<T>(
  response: Response,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new QuoteRequestError(
      "The server returned an invalid quote response.",
      response.status,
    );
  }
  if (!response.ok) {
    const problem = ApiErrorResponseSchema.safeParse(body);
    const message = problem.success
      ? Array.isArray(problem.data.message)
        ? problem.data.message.join(" ")
        : problem.data.message
      : "The quote request could not be completed.";
    throw new QuoteRequestError(
      message,
      response.status,
      problem.success ? problem.data.errorCode : undefined,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new QuoteRequestError(
      "The server returned an invalid quote response.",
      response.status,
    );
  }
  return result.data;
}

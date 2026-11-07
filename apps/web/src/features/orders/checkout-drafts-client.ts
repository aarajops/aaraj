import "client-only";

import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  CheckoutDraftDetailSchema,
  CheckoutDraftOutcomeInputSchema,
  CheckoutDraftPreviewInputSchema,
  CheckoutDraftPreviewSchema,
  CheckoutDraftCreateOrderInputSchema,
  OrderCreatedSchema,
  type CheckoutDraftOutcomeInput,
  type CheckoutDraftPreviewInput,
  type CheckoutDraftCreateOrderInput,
} from "@aaraj/contracts";

async function read<T>(
  response: Response,
  schema: { parse(value: unknown): T },
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) {
    const error = ApiErrorResponseSchema.safeParse(body);
    throw new Error(
      error.success
        ? Array.isArray(error.data.message)
          ? error.data.message.join(" ")
          : error.data.message
        : "The checkout draft request failed.",
    );
  }
  return schema.parse(body);
}

export async function fetchCheckoutDraft(id: string) {
  return read(
    await fetch(
      `${API_V1_BASE_PATH}/checkout-drafts/${encodeURIComponent(id)}`,
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    ),
    CheckoutDraftDetailSchema,
  );
}

export async function saveCallOutcome(
  id: string,
  input: CheckoutDraftOutcomeInput,
) {
  return read(
    await fetch(
      `${API_V1_BASE_PATH}/checkout-drafts/${encodeURIComponent(id)}/call-outcome`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CheckoutDraftOutcomeInputSchema.parse(input)),
      },
    ),
    CheckoutDraftDetailSchema,
  );
}

export async function previewCheckoutDraft(
  id: string,
  input: CheckoutDraftPreviewInput,
) {
  return read(
    await fetch(
      `${API_V1_BASE_PATH}/checkout-drafts/${encodeURIComponent(id)}/preview`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CheckoutDraftPreviewInputSchema.parse(input)),
      },
    ),
    CheckoutDraftPreviewSchema,
  );
}

export async function createCheckoutDraftOrder(
  id: string,
  input: CheckoutDraftCreateOrderInput,
) {
  return read(
    await fetch(
      `${API_V1_BASE_PATH}/checkout-drafts/${encodeURIComponent(id)}/create-order`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CheckoutDraftCreateOrderInputSchema.parse(input)),
      },
    ),
    OrderCreatedSchema,
  );
}

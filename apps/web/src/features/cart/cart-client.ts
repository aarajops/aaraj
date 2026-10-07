import "client-only";

import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  CartMergeResultSchema,
  CartSchema,
  type Cart,
  type CartMergeResult,
} from "@aaraj/contracts";

export class CartRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "CartRequestError";
  }
}

export async function fetchCart(): Promise<Cart> {
  const response = await fetch(`${API_V1_BASE_PATH}/cart`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  return readResponse(response, CartSchema);
}

export async function clearCart(): Promise<Cart> {
  const response = await fetch(`${API_V1_BASE_PATH}/cart`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
  });
  return readResponse(response, CartSchema);
}

export async function setCartLine(
  variantId: string,
  quantity: number,
  revision: number,
): Promise<Cart> {
  const query = new URLSearchParams({ revision: String(revision) });
  const response = await fetch(
    `${API_V1_BASE_PATH}/cart/lines/${encodeURIComponent(variantId)}?${query}`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, revision }),
    },
  );
  return readResponse(response, CartSchema);
}

export async function removeCartLine(
  variantId: string,
  revision: number,
): Promise<Cart> {
  const query = new URLSearchParams({ revision: String(revision) });
  const response = await fetch(
    `${API_V1_BASE_PATH}/cart/lines/${encodeURIComponent(variantId)}?${query}`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return readResponse(response, CartSchema);
}

export async function mergeGuestCart(): Promise<CartMergeResult> {
  const response = await fetch(`${API_V1_BASE_PATH}/cart/merge`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
  });
  return readResponse(response, CartMergeResultSchema);
}

export async function fetchGuestCart(): Promise<Cart> {
  const response = await fetch(`${API_V1_BASE_PATH}/cart/guest`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  return readResponse(response, CartSchema);
}

export async function clearGuestCart(): Promise<Cart> {
  const response = await fetch(`${API_V1_BASE_PATH}/cart/guest`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
  });
  return readResponse(response, CartSchema);
}

export async function setGuestCartLine(
  variantId: string,
  quantity: number,
  revision: number,
): Promise<Cart> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/cart/guest/lines/${encodeURIComponent(variantId)}`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, revision }),
    },
  );
  return readResponse(response, CartSchema);
}

export async function removeGuestCartLine(
  variantId: string,
  revision: number,
): Promise<Cart> {
  const query = new URLSearchParams({ revision: String(revision) });
  const response = await fetch(
    `${API_V1_BASE_PATH}/cart/guest/lines/${encodeURIComponent(variantId)}?${query}`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return readResponse(response, CartSchema);
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
    throw new CartRequestError(
      "The server returned an invalid cart response.",
      response.status,
    );
  }
  if (!response.ok) {
    const problem = ApiErrorResponseSchema.safeParse(body);
    const message = problem.success
      ? Array.isArray(problem.data.message)
        ? problem.data.message.join(" ")
        : problem.data.message
      : "The cart request could not be completed.";
    throw new CartRequestError(
      message,
      response.status,
      problem.success ? problem.data.errorCode : undefined,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new CartRequestError(
      "The server returned an invalid cart response.",
      response.status,
    );
  }
  return result.data;
}

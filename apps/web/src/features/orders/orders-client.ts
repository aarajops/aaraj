"use client";

import "client-only";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  CreateOrderInputSchema,
  OrderCreatedSchema,
  OrderSchema,
  OrderServiceabilityInputSchema,
  type CreateOrderInput,
  type OrderCreated,
  type Order,
  type OrderServiceabilityInput,
} from "@aaraj/contracts";

export class OrderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "OrderRequestError";
  }
}

export async function createCodOrder(
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<OrderCreated> {
  const validatedInput = CreateOrderInputSchema.parse(input);
  await prepareGuestCheckoutAccess(idempotencyKey);
  const response = await fetch(`${API_V1_BASE_PATH}/orders`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(validatedInput),
  });
  return readResponse(response, OrderCreatedSchema);
}

export async function resumeCodOrder(
  idempotencyKey: string,
): Promise<OrderCreated> {
  const response = await fetch(`${API_V1_BASE_PATH}/orders/checkout/replay`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return readResponse(response, OrderCreatedSchema);
}

async function prepareGuestCheckoutAccess(
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(`${API_V1_BASE_PATH}/orders/checkout-access`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (response.ok) return;
  await readResponse(response, {
    safeParse: () => ({ success: false as const }),
  });
}

export async function fetchOrder(orderId: string): Promise<Order> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/${encodeURIComponent(orderId)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, OrderSchema);
}

export async function updateOrderServiceability(
  orderId: string,
  input: OrderServiceabilityInput,
): Promise<Order> {
  const validatedInput = OrderServiceabilityInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/serviceability`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderSchema);
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
    throw new OrderRequestError(
      "The server returned an invalid Order response.",
      response.status,
    );
  }
  if (!response.ok) {
    const problem = ApiErrorResponseSchema.safeParse(body);
    const message = problem.success
      ? Array.isArray(problem.data.message)
        ? problem.data.message.join(" ")
        : problem.data.message
      : "The Order request could not be completed.";
    throw new OrderRequestError(
      message,
      response.status,
      problem.success ? problem.data.errorCode : undefined,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new OrderRequestError(
      "The server returned an invalid Order response.",
      response.status,
    );
  }
  return result.data;
}

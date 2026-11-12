"use client";

import "client-only";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  OrderCollectionInputSchema,
  CreateOrderInputSchema,
  OrderCreatedSchema,
  OrderDispatchInputSchema,
  OrderFulfillmentOutcomeInputSchema,
  OrderItemAddInputSchema,
  OrderItemRemoveQuerySchema,
  OrderManualDiscountUpdateInputSchema,
  OrderManagementDetailSchema,
  OrderSchema,
  OrderStatusUpdateInputSchema,
  CheckoutDraftSaveSchema,
  CheckoutDraftSaveResultSchema,
  type CreateOrderInput,
  type OrderCollectionInput,
  type OrderCreated,
  type OrderDispatchInput,
  type OrderFulfillmentOutcomeInput,
  type OrderItemAddInput,
  type OrderManualDiscountUpdateInput,
  type Order,
  type OrderManagementDetail,
  type OrderStatusUpdateInput,
  type CheckoutDraftSave,
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

export async function saveCheckoutDraft(
  input: CheckoutDraftSave,
  options: { keepalive?: boolean } = {},
) {
  const validated = CheckoutDraftSaveSchema.parse(input);
  const response = await fetch(`${API_V1_BASE_PATH}/checkout-drafts`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: options.keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated),
  });
  if (!response.ok) return null;
  const body = await response.text();
  return body
    ? CheckoutDraftSaveResultSchema.parse(JSON.parse(body) as unknown)
    : null;
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

export async function fetchManagedOrder(
  orderId: string,
): Promise<OrderManagementDetail> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, OrderManagementDetailSchema);
}

export async function updateOrderStatus(
  orderId: string,
  input: OrderStatusUpdateInput,
): Promise<OrderManagementDetail> {
  const validatedInput = OrderStatusUpdateInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/status`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderManagementDetailSchema);
}

export async function addOrderItem(
  orderId: string,
  input: OrderItemAddInput,
): Promise<OrderManagementDetail> {
  const validatedInput = OrderItemAddInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/items`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderManagementDetailSchema);
}

export async function removeOrderItem(
  orderId: string,
  variantId: string,
  expectedQuantity: number,
): Promise<OrderManagementDetail> {
  const query = OrderItemRemoveQuerySchema.parse({ expectedQuantity });
  const search = new URLSearchParams({
    expectedQuantity: String(query.expectedQuantity),
  });
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/items/${encodeURIComponent(variantId)}?${search}`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return readResponse(response, OrderManagementDetailSchema);
}

export async function updateOrderManualDiscount(
  orderId: string,
  input: OrderManualDiscountUpdateInput,
): Promise<OrderManagementDetail> {
  const validatedInput = OrderManualDiscountUpdateInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/discount`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderManagementDetailSchema);
}

export async function dispatchCodOrder(
  orderId: string,
  input: OrderDispatchInput,
  commandId: string,
): Promise<Order> {
  const validatedInput = OrderDispatchInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/dispatch`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderSchema);
}

export async function recordOrderFulfillmentOutcome(
  orderId: string,
  input: OrderFulfillmentOutcomeInput,
): Promise<Order> {
  const validatedInput = OrderFulfillmentOutcomeInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/fulfillment-outcome`,
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

export async function recordOrderCodCollection(
  orderId: string,
  input: OrderCollectionInput,
): Promise<Order> {
  const validatedInput = OrderCollectionInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/collection`,
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

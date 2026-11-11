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
  OrderManagementDetailSchema,
  OrderSchema,
  OrderStatusUpdateInputSchema,
  CheckoutDraftSaveSchema,
  CheckoutDraftSaveResultSchema,
  CreateOrderReturnInputSchema,
  DecideOrderReturnInputSchema,
  InspectOrderReturnInputSchema,
  OrderReturnCaseSchema,
  OrderReturnCasesSchema,
  ReceiveOrderReturnInputSchema,
  RecordOrderReturnRefundInputSchema,
  ImportCourierRemittanceInputSchema,
  CourierRemittanceBatchSchema,
  CourierRemittanceBatchesSchema,
  ReconcileCourierRemittanceInputSchema,
  ResolveCourierRemittanceLineInputSchema,
  ConfirmCourierSettlementInputSchema,
  OrderNotificationSchema,
  OrderNotificationsSchema,
  ResolveOrderNotificationInputSchema,
  type CreateOrderReturnInput,
  type DecideOrderReturnInput,
  type InspectOrderReturnInput,
  type OrderReturnCase,
  type OrderReturnCases,
  OrderReceiptSchema,
  type OrderReceipt,
  type ReceiveOrderReturnInput,
  type RecordOrderReturnRefundInput,
  type CourierRemittanceBatch,
  type CourierRemittanceBatches,
  type ImportCourierRemittanceInput,
  type ReconcileCourierRemittanceInput,
  type ResolveCourierRemittanceLineInput,
  type ConfirmCourierSettlementInput,
  type OrderNotifications,
  type OrderNotification,
  type ResolveOrderNotificationInput,
  type CreateOrderInput,
  type OrderCollectionInput,
  type OrderCreated,
  type OrderDispatchInput,
  type OrderFulfillmentOutcomeInput,
  type OrderItemAddInput,
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

export async function withdrawOrderSmsConsent(orderId: string): Promise<void> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/${encodeURIComponent(orderId)}/sms-consent`,
    { method: "DELETE", cache: "no-store", credentials: "same-origin" },
  );
  if (response.status === 204) return;
  await readResponse(response, {
    safeParse: () => ({ success: false as const }),
  });
  throw new Error("SMS consent could not be withdrawn.");
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
): Promise<OrderManagementDetail> {
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
  return readResponse(response, OrderManagementDetailSchema);
}

export async function recordOrderCodCollection(
  orderId: string,
  input: OrderCollectionInput,
): Promise<OrderManagementDetail> {
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
  return readResponse(response, OrderManagementDetailSchema);
}

export async function fetchOrderReturnCases(
  orderId: string,
): Promise<OrderReturnCases> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/returns`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, OrderReturnCasesSchema);
}

export async function fetchOrderReceipt(
  orderId: string,
): Promise<OrderReceipt> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/receipt`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, OrderReceiptSchema);
}

export async function issueOrderReceipt(
  orderId: string,
): Promise<OrderReceipt> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}/receipt`,
    { method: "POST", cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, OrderReceiptSchema);
}

export async function createOrderReturnCase(
  orderId: string,
  input: CreateOrderReturnInput,
): Promise<OrderReturnCase> {
  return orderOperationMutation(
    `/orders/manage/${encodeURIComponent(orderId)}/returns`,
    input,
    CreateOrderReturnInputSchema,
  );
}

export async function decideOrderReturnCase(
  returnCaseId: string,
  input: DecideOrderReturnInput,
): Promise<OrderReturnCase> {
  return orderOperationMutation(
    `/orders/manage/returns/${encodeURIComponent(returnCaseId)}/decision`,
    input,
    DecideOrderReturnInputSchema,
    "PATCH",
  );
}

export async function receiveOrderReturn(
  returnCaseId: string,
  input: ReceiveOrderReturnInput,
): Promise<OrderReturnCase> {
  return orderOperationMutation(
    `/orders/manage/returns/${encodeURIComponent(returnCaseId)}/receive`,
    input,
    ReceiveOrderReturnInputSchema,
  );
}

export async function inspectOrderReturn(
  returnCaseId: string,
  input: InspectOrderReturnInput,
): Promise<OrderReturnCase> {
  return orderOperationMutation(
    `/orders/manage/returns/${encodeURIComponent(returnCaseId)}/inspect`,
    input,
    InspectOrderReturnInputSchema,
  );
}

export async function recordOrderReturnRefund(
  returnCaseId: string,
  input: RecordOrderReturnRefundInput,
): Promise<OrderReturnCase> {
  return orderOperationMutation(
    `/orders/manage/returns/${encodeURIComponent(returnCaseId)}/refund`,
    input,
    RecordOrderReturnRefundInputSchema,
  );
}

export async function importCourierRemittance(
  input: ImportCourierRemittanceInput,
): Promise<CourierRemittanceBatch> {
  const validatedInput = ImportCourierRemittanceInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, CourierRemittanceBatchSchema);
}

export async function fetchCourierRemittance(
  batchId: string,
): Promise<CourierRemittanceBatch> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances/${encodeURIComponent(batchId)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return readResponse(response, CourierRemittanceBatchSchema);
}

export async function fetchCourierRemittances(): Promise<CourierRemittanceBatches> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return readResponse(response, CourierRemittanceBatchesSchema);
}

export async function resolveCourierRemittanceLine(
  batchId: string,
  lineId: string,
  input: ResolveCourierRemittanceLineInput,
): Promise<CourierRemittanceBatch> {
  const validatedInput = ResolveCourierRemittanceLineInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances/${encodeURIComponent(batchId)}/lines/${encodeURIComponent(lineId)}/resolve`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, CourierRemittanceBatchSchema);
}

export async function reconcileCourierRemittance(
  batchId: string,
  input: ReconcileCourierRemittanceInput,
): Promise<CourierRemittanceBatch> {
  const validatedInput = ReconcileCourierRemittanceInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances/${encodeURIComponent(batchId)}/reconcile`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, CourierRemittanceBatchSchema);
}

export async function confirmCourierSettlement(
  batchId: string,
  input: ConfirmCourierSettlementInput,
): Promise<CourierRemittanceBatch> {
  const validatedInput = ConfirmCourierSettlementInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/remittances/${encodeURIComponent(batchId)}/bank-confirmation`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, CourierRemittanceBatchSchema);
}

export async function fetchOrderNotifications(): Promise<OrderNotifications> {
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/notifications/outbox`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return readResponse(response, OrderNotificationsSchema);
}

export async function resolveOrderNotification(
  notificationId: string,
  input: ResolveOrderNotificationInput,
): Promise<OrderNotification> {
  const validatedInput = ResolveOrderNotificationInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/orders/manage/notifications/${encodeURIComponent(notificationId)}/resolve`,
    {
      method: "PATCH",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validatedInput),
    },
  );
  return readResponse(response, OrderNotificationSchema);
}

async function orderOperationMutation<TInput>(
  path: string,
  input: TInput,
  inputSchema: { parse(value: unknown): TInput },
  method: "POST" | "PATCH" = "POST",
): Promise<OrderReturnCase> {
  const validatedInput = inputSchema.parse(input);
  const response = await fetch(`${API_V1_BASE_PATH}${path}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validatedInput),
  });
  return readResponse(response, OrderReturnCaseSchema);
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

"use client";

import "client-only";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  PathaoBookingInputSchema,
  PathaoBookingManagementSchema,
  PathaoBookingOptionsSchema,
  PathaoBookingSchema,
  PathaoCustomerTrackingSchema,
  PathaoManagementIssuesSchema,
  PathaoManualReconciliationInputSchema,
  PathaoWebhookResolutionInputSchema,
  PathaoWebhookResolutionResultSchema,
  type PathaoManualReconciliationInput,
  type PathaoBookingInput,
  type PathaoWebhookResolutionInput,
} from "@aaraj/contracts";

export class PathaoClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PathaoClientError";
  }
}

export async function getPathaoBookingOptions() {
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/stores`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  return read(response, PathaoBookingOptionsSchema);
}

export async function getPathaoBooking(orderId: string) {
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${encodeURIComponent(orderId)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return read(response, PathaoBookingManagementSchema);
}

export async function getPathaoManagementIssues() {
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/issues`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return read(response, PathaoManagementIssuesSchema);
}

export async function resolvePathaoWebhookIssue(
  eventId: string,
  input: PathaoWebhookResolutionInput,
  commandId: string,
) {
  const validated = PathaoWebhookResolutionInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/webhooks/${encodeURIComponent(eventId)}/resolve`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify(validated),
    },
  );
  return read(response, PathaoWebhookResolutionResultSchema);
}

export async function submitPathaoBooking(
  orderId: string,
  input: PathaoBookingInput,
  commandId: string,
) {
  const validated = PathaoBookingInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${encodeURIComponent(orderId)}/book`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify(validated),
    },
  );
  return read(response, PathaoBookingSchema);
}

export async function reconcilePathaoBooking(
  orderId: string,
  input: PathaoManualReconciliationInput,
  commandId: string,
) {
  const validated = PathaoManualReconciliationInputSchema.parse(input);
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${encodeURIComponent(orderId)}/reconcile`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": commandId,
      },
      body: JSON.stringify(validated),
    },
  );
  return read(response, PathaoBookingSchema);
}

export async function getPathaoCustomerTracking(orderId: string) {
  const response = await fetch(
    `${API_V1_BASE_PATH}/delivery/pathao/orders/${encodeURIComponent(orderId)}/tracking`,
    { cache: "no-store", credentials: "same-origin" },
  );
  return read(response, PathaoCustomerTrackingSchema);
}

async function read<T>(
  response: Response,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PathaoClientError(
      "The Pathao integration response was invalid.",
      response.status,
    );
  }
  if (!response.ok) {
    const problem = ApiErrorResponseSchema.safeParse(body);
    const message = problem.success
      ? Array.isArray(problem.data.message)
        ? problem.data.message.join(" ")
        : problem.data.message
      : "The Pathao request could not be completed.";
    throw new PathaoClientError(message, response.status);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new PathaoClientError(
      "The Pathao integration response was invalid.",
      response.status,
    );
  }
  return result.data;
}

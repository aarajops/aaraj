import type { Order } from "@aaraj/contracts";

export const ORDERS_PATHAO_PORT = Symbol("ORDERS_PATHAO_PORT");

export type PathaoOrderBookingSnapshot = {
  id: string;
  reference: string;
  status: Order["status"];
  serviceability: Order["serviceability"];
  fulfillmentStatus: Order["fulfillmentStatus"];
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  customerInstructions: string | null;
  codAmountDueBdt: number;
};

export type PathaoFulfillmentSnapshot = {
  fulfillmentStatus: Order["fulfillmentStatus"];
  dispatchedAt: string | null;
};

export type PathaoBookingClaimStatus =
  "submitting" | "booked" | "outcome_unknown" | "reconciliation_required";

export type PathaoBookingClaimSnapshot = {
  orderId: string;
  status: PathaoBookingClaimStatus;
};

export type PathaoBookingClaimUpdate = {
  orderId: string;
  commandId: string;
  requestFingerprint: string;
  status: PathaoBookingClaimStatus;
  lastErrorCode: string | null;
};

export type PathaoOrderReference = { id: string; reference: string };

export interface OrdersPathaoPort {
  getPathaoBookingClaimStatus(
    orderId: string,
  ): Promise<PathaoBookingClaimStatus | null>;
  getPathaoBookingClaimStatuses(
    orderIds: readonly string[],
  ): Promise<PathaoBookingClaimSnapshot[]>;
  getPathaoBookingSnapshot(
    orderId: string,
  ): Promise<PathaoOrderBookingSnapshot>;
  getPathaoFulfillmentSnapshot(
    orderId: string,
  ): Promise<PathaoFulfillmentSnapshot>;
  beginPathaoBookingClaim(
    orderId: string,
    commandId: string,
    requestFingerprint: string,
    status: "submitting" | "reconciliation_required",
  ): Promise<PathaoOrderBookingSnapshot>;
  assertPathaoBookingClaim(
    orderId: string,
    commandId: string,
    requestFingerprint: string,
  ): Promise<void>;
  setPathaoBookingClaim(update: PathaoBookingClaimUpdate): Promise<void>;
  recoverPathaoBookingClaims(activeOrderIds: readonly string[]): Promise<void>;
  getOrderReferences(
    orderIds: readonly string[],
  ): Promise<PathaoOrderReference[]>;
  authorizePathaoTrackingRead(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<void>;
}

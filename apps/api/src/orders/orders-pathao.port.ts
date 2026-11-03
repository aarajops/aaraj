import type { Order } from "@aaraj/contracts";
import type { AuditTransaction } from "../platform/audit/audit.types.js";

export const ORDERS_PATHAO_PORT = Symbol("ORDERS_PATHAO_PORT");

export type PathaoOrderBookingSnapshot = {
  id: string;
  reference: string;
  status: Order["status"];
  fulfillmentStatus: Order["fulfillmentStatus"];
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  customerInstructions: string | null;
  itemQuantity: number;
  codAmountDueBdt: number;
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
  releasePathaoBookingClaimWithinTransaction(
    transaction: AuditTransaction,
    orderId: string,
  ): Promise<boolean>;
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

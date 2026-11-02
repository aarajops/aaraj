import type { AuditTransaction } from "../platform/audit/audit.types.js";

export const INVENTORY_RESERVATION_PORT = Symbol("INVENTORY_RESERVATION_PORT");

export type InventoryReservationStatus = "held" | "released" | "consumed";
export type InventoryReservationOperation =
  "reserve" | "extend" | "release" | "consume";

export interface InventoryReservationLine {
  variantId: string;
  quantity: number;
}

export interface InventoryReserveCommand {
  commandId: string;
  lines: readonly InventoryReservationLine[];
}

export interface InventoryReservationTransitionCommand {
  commandId: string;
  reservationId: string;
}

export interface InventoryReservationExtendCommand extends InventoryReservationTransitionCommand {
  lines: readonly InventoryReservationLine[];
}

export type InventoryReservationReleaseLinesCommand =
  InventoryReservationExtendCommand;

export interface InventoryReservation {
  id: string;
  status: InventoryReservationStatus;
  lines: InventoryReservationLine[];
  createdAt: string;
  updatedAt: string;
}

/** Internal module contract for Order; it is not exposed as a customer API. */
export interface InventoryReservationPort {
  reserve(command: InventoryReserveCommand): Promise<InventoryReservation>;
  reserveWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReserveCommand,
  ): Promise<InventoryReservation>;
  extendWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationExtendCommand,
  ): Promise<InventoryReservation>;
  releaseLinesWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationReleaseLinesCommand,
  ): Promise<InventoryReservation>;
  release(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  releaseWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  consume(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  consumeWithinTransaction(
    transaction: AuditTransaction,
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  getReservation(reservationId: string): Promise<InventoryReservation | null>;
}

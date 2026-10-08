export const INVENTORY_RESERVATION_PORT = Symbol("INVENTORY_RESERVATION_PORT");

export type InventoryReservationStatus = "held" | "released" | "consumed";
export type InventoryReservationOperation = "reserve" | "release" | "consume";

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
  release(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  consume(
    command: InventoryReservationTransitionCommand,
  ): Promise<InventoryReservation>;
  getReservation(reservationId: string): Promise<InventoryReservation | null>;
}

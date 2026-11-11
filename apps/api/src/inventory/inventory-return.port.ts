import type { AuditTransaction } from "../platform/audit/audit.types.js";

export const INVENTORY_RETURN_PORT = Symbol("INVENTORY_RETURN_PORT");

export interface InventoryReturnPort {
  restockReturnedGoodsWithinTransaction(
    transaction: AuditTransaction,
    input: {
      commandId: string;
      variantId: string;
      quantity: number;
      actorId: string;
      reason: string;
    },
  ): Promise<{ quantityOnHand: number; replayed: boolean }>;
}

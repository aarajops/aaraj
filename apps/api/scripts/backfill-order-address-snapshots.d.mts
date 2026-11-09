import type { OrderAddress } from "@aaraj/contracts";
import type { PoolClient } from "pg";
import type { OrderPiiKeyring } from "../src/platform/crypto/order-pii-keyring.js";

export function backfillOrderAddressSnapshots(
  client: PoolClient,
  keyring: OrderPiiKeyring,
): Promise<number>;

export function decryptAddress(
  value: string,
  orderId: string,
  keyring: OrderPiiKeyring,
  addressSchema: { parse(value: unknown): OrderAddress },
): OrderAddress;

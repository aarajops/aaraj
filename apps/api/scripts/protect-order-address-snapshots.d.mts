import type { Pool, PoolClient } from "pg";

export function protectOrderAddressSnapshots(
  client: PoolClient,
): Promise<number>;

export function orderAddressProtectionStatus(
  client: Pool | PoolClient,
): Promise<"schema-missing" | "required" | "complete">;

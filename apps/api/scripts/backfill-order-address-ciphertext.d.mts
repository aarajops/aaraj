type QueryResult = { rows: Record<string, unknown>[] };

type MigrationClient = {
  query(statement: string, parameters?: unknown[]): Promise<QueryResult>;
};

type AddressCrypto = {
  encryptOrderAddress(orderId: string, address: unknown): string;
  decryptOrderAddress(orderId: string, envelope: string): unknown;
  makeOrderAddressLookups(address: unknown): {
    namePrefixes: string[];
    phonePrefixes: string[];
  };
};

export function backfillOrderAddressCiphertext(
  client: MigrationClient,
  crypto: AddressCrypto,
): Promise<number>;

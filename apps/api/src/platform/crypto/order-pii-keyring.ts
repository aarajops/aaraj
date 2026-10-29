import { Buffer } from "node:buffer";

export type OrderPiiKeyring = {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export function readOrderPiiKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): OrderPiiKeyring {
  const encodedKeyring = environment.ORDER_PII_KEYRING?.trim();
  if (!encodedKeyring) {
    const legacyKey = parseOrderPiiKey(
      environment.ORDER_PII_ENCRYPTION_KEY?.trim(),
      "ORDER_PII_ENCRYPTION_KEY",
    );
    return { activeKeyId: "legacy", keys: new Map([["legacy", legacyKey]]) };
  }

  if (environment.ORDER_PII_ENCRYPTION_KEY?.trim()) {
    throw new Error(
      "Remove ORDER_PII_ENCRYPTION_KEY after configuring ORDER_PII_KEYRING.",
    );
  }
  let configuration: unknown;
  try {
    configuration = JSON.parse(encodedKeyring);
  } catch {
    throw new Error("ORDER_PII_KEYRING must be a JSON object.");
  }
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  ) {
    throw new Error("ORDER_PII_KEYRING must be a JSON object.");
  }
  const { activeKeyId, keys: entries } = configuration as {
    activeKeyId?: unknown;
    keys?: unknown;
  };
  if (
    typeof activeKeyId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(activeKeyId)
  ) {
    throw new Error("ORDER_PII_KEYRING must include a valid activeKeyId.");
  }
  if (
    !entries ||
    typeof entries !== "object" ||
    Array.isArray(entries) ||
    Object.keys(entries).length === 0
  ) {
    throw new Error("ORDER_PII_KEYRING.keys must contain at least one key.");
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encodedKey] of Object.entries(entries)) {
    if (!/^[A-Za-z0-9_-]+$/.test(keyId)) {
      throw new Error(
        "Order PII encryption key IDs must use letters, digits, underscores, or hyphens.",
      );
    }
    if (typeof encodedKey !== "string") {
      throw new Error("Every Order PII encryption key must be a string.");
    }
    keys.set(keyId, parseOrderPiiKey(encodedKey, `key ${keyId}`));
  }

  if (!keys.has("legacy")) {
    throw new Error(
      'ORDER_PII_KEYRING.keys must retain the "legacy" key for existing addresses and checkout retries.',
    );
  }
  if (!keys.has(activeKeyId)) {
    throw new Error(
      "ORDER_PII_KEYRING.activeKeyId must name one of ORDER_PII_KEYRING.keys.",
    );
  }
  return { activeKeyId, keys };
}

function parseOrderPiiKey(encoded: string | undefined, label: string): Buffer {
  if (!encoded) throw new Error(`${label} must be configured.`);
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error(
      `${label} must be a canonical base64url encoding of 32 random bytes.`,
    );
  }
  return key;
}

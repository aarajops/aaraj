import { Buffer } from "node:buffer";
import type { PathaoDeliveryType } from "@aaraj/contracts";

export type PathaoEnvironment = "sandbox" | "live";
export type PathaoMode = "disabled" | PathaoEnvironment;

export type PathaoConfiguration = {
  mode: PathaoEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  webhookSecret: string;
  deliveryType: PathaoDeliveryType;
  tokenEncryptionKey: Buffer;
  approvedStoreIds: ReadonlySet<number>;
  passwordGrantProductionApproved: boolean;
};

export function readPathaoMode(
  environment: NodeJS.ProcessEnv = process.env,
): PathaoMode {
  const mode = environment.PATHAO_MODE?.trim() || "disabled";
  if (mode !== "disabled" && mode !== "sandbox" && mode !== "live") {
    throw new Error("PATHAO_MODE must be disabled, sandbox, or live.");
  }
  return mode;
}

export function readPathaoConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PathaoConfiguration | null {
  const mode = readPathaoMode(environment);
  if (mode === "disabled") return null;

  const prefix = mode === "sandbox" ? "PATHAO_SANDBOX" : "PATHAO_LIVE";
  const clientId = required(
    environment[`${prefix}_CLIENT_ID`],
    `${prefix}_CLIENT_ID`,
  );
  const clientSecret = required(
    environment[`${prefix}_CLIENT_SECRET`],
    `${prefix}_CLIENT_SECRET`,
  );
  const username = required(
    environment[`${prefix}_USERNAME`],
    `${prefix}_USERNAME`,
  );
  const password = required(
    environment[`${prefix}_PASSWORD`],
    `${prefix}_PASSWORD`,
  );
  const webhookSecret = required(
    environment[`${prefix}_WEBHOOK_SECRET`],
    `${prefix}_WEBHOOK_SECRET`,
  );
  const deliveryType = readDeliveryType(environment.PATHAO_DELIVERY_TYPE);
  const tokenEncryptionKey = decodeKey(environment.PATHAO_TOKEN_ENCRYPTION_KEY);

  if (
    mode === "live" &&
    environment.PATHAO_LIVE_CREDENTIALS_ROTATED?.trim() !== "true"
  ) {
    throw new Error(
      "Pathao live credentials must be rotated before activation.",
    );
  }
  const passwordGrantProductionApproved =
    environment.PATHAO_PASSWORD_GRANT_PRODUCTION_APPROVED?.trim() === "true";
  if (mode === "live" && !passwordGrantProductionApproved) {
    throw new Error(
      "Pathao's documented password grant requires explicit production approval.",
    );
  }

  return {
    mode,
    baseUrl:
      mode === "sandbox"
        ? "https://courier-api-sandbox.pathao.com"
        : "https://api-hermes.pathao.com",
    clientId,
    clientSecret,
    username,
    password,
    webhookSecret,
    deliveryType,
    tokenEncryptionKey,
    approvedStoreIds: readIntegerSet(
      environment[`${prefix}_APPROVED_STORE_IDS`],
      `${prefix}_APPROVED_STORE_IDS`,
    ),
    passwordGrantProductionApproved,
  };
}

function readDeliveryType(value: string | undefined): PathaoDeliveryType {
  if (value === "48") return 48;
  if (value === "12") return 12;
  throw new Error(
    "PATHAO_DELIVERY_TYPE must be one documented integer value: 48 or 12.",
  );
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} must be configured.`);
  return normalized;
}

function decodeKey(value: string | undefined): Buffer {
  const encoded = value?.trim();
  if (!encoded)
    throw new Error("PATHAO_TOKEN_ENCRYPTION_KEY must be configured.");
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error(
      "PATHAO_TOKEN_ENCRYPTION_KEY must be canonical base64url for 32 random bytes.",
    );
  }
  return key;
}

function readIntegerSet(value: string | undefined, name: string): Set<number> {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      `${name} must contain comma-separated positive integer IDs.`,
    );
  }
  const values = normalized.split(",").map((item) => {
    if (!/^[1-9][0-9]*$/.test(item)) {
      throw new Error(
        `${name} must contain comma-separated positive integer IDs.`,
      );
    }
    const parsed = Number(item);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
      throw new Error(
        `${name} must contain comma-separated positive integer IDs.`,
      );
    }
    return parsed;
  });
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must not contain duplicate IDs.`);
  }
  return new Set(values);
}

import { Buffer } from "node:buffer";

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
  tokenEncryptionKey: Buffer;
  approvedStoreIds: ReadonlySet<number>;
  allowedDeliveryTypes: ReadonlySet<12 | 48>;
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
    tokenEncryptionKey,
    approvedStoreIds: readIntegerSet(
      environment[`${prefix}_APPROVED_STORE_IDS`],
      `${prefix}_APPROVED_STORE_IDS`,
    ),
    allowedDeliveryTypes: readDeliveryTypes(
      environment[`${prefix}_DELIVERY_TYPES`],
      `${prefix}_DELIVERY_TYPES`,
    ),
    passwordGrantProductionApproved,
  };
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
  if (!value?.trim()) return new Set();
  const values = value.split(",").map((item) => {
    const parsed = Number(item.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
      throw new Error(
        `${name} must contain comma-separated positive integer IDs.`,
      );
    }
    return parsed;
  });
  return new Set(values);
}

function readDeliveryTypes(
  value: string | undefined,
  name: string,
): Set<12 | 48> {
  if (!value?.trim()) return new Set();
  const values = value.split(",").map((item) => Number(item.trim()));
  if (values.some((item) => item !== 12 && item !== 48)) {
    throw new Error(
      `${name} may contain only Pathao delivery types 12 and 48.`,
    );
  }
  return new Set(values as Array<12 | 48>);
}

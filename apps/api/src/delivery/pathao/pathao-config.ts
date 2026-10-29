import {
  readOrderPiiKeyring,
  type OrderPiiKeyring,
} from "../../platform/crypto/order-pii-keyring.js";

export type PathaoEnvironment = "sandbox" | "live";

export type PathaoConfiguration = {
  mode: PathaoEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  webhookSecret: string;
  tokenEncryptionKeyring: OrderPiiKeyring;
};

const PATHAO_BASE_URLS = {
  "https://courier-api-sandbox.pathao.com": "sandbox",
  "https://api-hermes.pathao.com": "live",
} as const satisfies Record<string, PathaoEnvironment>;

export function readPathaoConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PathaoConfiguration | null {
  const baseUrl = environment.PATHAO_BASE_URL?.trim() ?? "";
  if (!baseUrl) {
    const hasCredentials = Object.entries(environment).some(
      ([key, value]) => key.startsWith("PATHAO_") && Boolean(value?.trim()),
    );
    if (hasCredentials) {
      throw new Error(
        "PATHAO_BASE_URL must be configured when Pathao credentials are present.",
      );
    }
    return null;
  }

  const mode = PATHAO_BASE_URLS[baseUrl as keyof typeof PATHAO_BASE_URLS];
  if (!mode) {
    throw new Error(
      "PATHAO_BASE_URL must match Pathao's documented sandbox or live URL.",
    );
  }

  const prefix = mode === "sandbox" ? "PATHAO_SANDBOX" : "PATHAO_LIVE";
  return {
    mode,
    baseUrl,
    clientId: required(
      environment[`${prefix}_CLIENT_ID`],
      `${prefix}_CLIENT_ID`,
    ),
    clientSecret: required(
      environment[`${prefix}_CLIENT_SECRET`],
      `${prefix}_CLIENT_SECRET`,
    ),
    username: required(environment[`${prefix}_USERNAME`], `${prefix}_USERNAME`),
    password: required(environment[`${prefix}_PASSWORD`], `${prefix}_PASSWORD`),
    webhookSecret: required(
      environment[`${prefix}_WEBHOOK_SECRET`],
      `${prefix}_WEBHOOK_SECRET`,
    ),
    tokenEncryptionKeyring: readOrderPiiKeyring(environment),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} must be configured.`);
  return normalized;
}

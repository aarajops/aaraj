import { Buffer } from "node:buffer";

export type PathaoEnvironment = "sandbox" | "live";

export type PathaoConfiguration = {
  mode: PathaoEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  webhookSecret: string;
  tokenEncryptionKey: Buffer;
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
      ([key, value]) =>
        key.startsWith("PATHAO_") &&
        key !== "PATHAO_TOKEN_ENCRYPTION_KEY" &&
        Boolean(value?.trim()),
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
    tokenEncryptionKey: decodeKey(environment.PATHAO_TOKEN_ENCRYPTION_KEY),
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

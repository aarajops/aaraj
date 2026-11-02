import {
  readOrderPiiKeyring,
  type OrderPiiKeyring,
} from "../../platform/crypto/order-pii-keyring.js";

export type PathaoConfiguration = {
  mode: "live";
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  webhookSecret: string;
  tokenEncryptionKeyring: OrderPiiKeyring;
};

const PATHAO_API_BASE_URL = "https://api-hermes.pathao.com";

export function readPathaoConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PathaoConfiguration | null {
  const isConfigured = [
    environment.PATHAO_CLIENT_ID,
    environment.PATHAO_CLIENT_SECRET,
    environment.PATHAO_USERNAME,
    environment.PATHAO_PASSWORD,
    environment.PATHAO_WEBHOOK_SECRET,
  ].some((value) => value !== undefined && value !== "");
  if (!isConfigured) return null;

  return {
    mode: "live",
    baseUrl: PATHAO_API_BASE_URL,
    clientId: required(environment.PATHAO_CLIENT_ID, "PATHAO_CLIENT_ID"),
    clientSecret: required(
      environment.PATHAO_CLIENT_SECRET,
      "PATHAO_CLIENT_SECRET",
    ),
    username: required(environment.PATHAO_USERNAME, "PATHAO_USERNAME"),
    password: required(environment.PATHAO_PASSWORD, "PATHAO_PASSWORD"),
    webhookSecret: required(
      environment.PATHAO_WEBHOOK_SECRET,
      "PATHAO_WEBHOOK_SECRET",
    ),
    tokenEncryptionKeyring: readOrderPiiKeyring(environment),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} must be configured.`);
  return normalized;
}

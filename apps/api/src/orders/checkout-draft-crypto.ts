import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { readOrderPiiKeyring } from "../platform/crypto/order-pii-keyring.js";

type Purpose = "form" | "guest-cart";

export function encryptDraftValue(
  id: string,
  purpose: Purpose,
  value: unknown,
): string {
  const keyring = readOrderPiiKeyring();
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error("The active Order PII key is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(
      `aaraj/checkout-draft/${purpose}/v1:${keyring.activeKeyId}:${id}`,
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    keyring.activeKeyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptDraftValue(
  id: string,
  purpose: Purpose,
  envelope: string,
): unknown {
  const [version, keyId, nonceValue, ciphertextValue, tagValue, extra] =
    envelope.split(".");
  if (
    version !== "v1" ||
    !keyId ||
    !nonceValue ||
    !ciphertextValue ||
    !tagValue ||
    extra
  ) {
    throw new Error("Invalid checkout draft ciphertext.");
  }
  const key = readOrderPiiKeyring().keys.get(keyId);
  if (!key) throw new Error("The checkout draft PII key is unavailable.");
  const nonce = Buffer.from(nonceValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (nonce.length !== 12 || tag.length !== 16)
    throw new Error("Invalid checkout draft ciphertext.");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(
    Buffer.from(`aaraj/checkout-draft/${purpose}/v1:${keyId}:${id}`),
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as unknown;
}

export function hashSuppressedPhone(phone: string): string {
  const key = readOrderPiiKeyring().keys.get("legacy");
  if (!key) throw new Error("The stable Order PII key is unavailable.");
  return createHmac("sha256", key)
    .update(`aaraj/checkout-call-suppression/v1:${phone}`)
    .digest("hex");
}

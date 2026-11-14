import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { OrderAddress } from "@aaraj/contracts";
import { OrderAddressSchema } from "@aaraj/contracts";
import { readOrderPiiKeyring } from "../platform/crypto/order-pii-keyring.js";

export type OrderAddressSnapshotEnvelope = {
  version: 3;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

type SearchField = "name" | "phone";

export function encryptOrderAddressSnapshot(
  orderId: string,
  address: OrderAddress,
): OrderAddressSnapshotEnvelope {
  const keyring = readOrderPiiKeyring();
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error("The active Order PII key is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(`aaraj/order-address/v3:${keyring.activeKeyId}:${orderId}`),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(OrderAddressSchema.parse(address)), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 3,
    keyId: keyring.activeKeyId,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptOrderAddressSnapshot(
  orderId: string,
  value: unknown,
): OrderAddress {
  try {
    if (!isAddressEnvelope(value)) throw new Error("Invalid envelope.");
    const key = readOrderPiiKeyring().keys.get(value.keyId);
    if (!key) throw new Error("The Order PII key is unavailable.");
    const nonce = decodeBase64Url(value.nonce);
    const ciphertext = decodeBase64Url(value.ciphertext);
    const tag = decodeBase64Url(value.tag);
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Invalid encrypted address.");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      Buffer.from(`aaraj/order-address/v3:${value.keyId}:${orderId}`),
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return OrderAddressSchema.parse(JSON.parse(plaintext) as unknown);
  } catch {
    throw new Error("The saved Order address is unavailable.");
  }
}

export function orderAddressSearchToken(
  field: SearchField,
  prefix: string,
): string {
  const key = readOrderPiiKeyring().keys.get("legacy");
  if (!key) throw new Error("The stable Order PII key is unavailable.");
  return createHmac("sha256", key)
    .update(`aaraj/order-address-search/v1:${field}:${prefix}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

export function orderAddressSearchTokens(address: OrderAddress): string[] {
  const name = normalizeAddressName(address.recipientName);
  const phone = normalizeAddressPhoneDigits(address.phone);
  const prefixes = new Set<string>();
  const nameCharacters = Array.from(name);
  for (let length = 2; length <= nameCharacters.length; length += 1) {
    prefixes.add(
      orderAddressSearchToken("name", nameCharacters.slice(0, length).join("")),
    );
  }
  for (let length = 2; length <= phone.length; length += 1) {
    prefixes.add(orderAddressSearchToken("phone", phone.slice(0, length)));
  }
  return [...prefixes];
}

export function normalizeAddressName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeAddressPhoneDigits(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[০-৯]/gu, (character) => String(character.charCodeAt(0) - 0x09e6))
    .replace(/\D/g, "");
}

export function canonicalAddressPhonePrefix(value: string): string {
  return /^0\d{1,10}$/.test(value) ? `88${value}` : value;
}

function isAddressEnvelope(
  value: unknown,
): value is OrderAddressSnapshotEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope.version === 3 &&
    typeof envelope.keyId === "string" &&
    /^[A-Za-z0-9_-]+$/.test(envelope.keyId) &&
    typeof envelope.nonce === "string" &&
    typeof envelope.ciphertext === "string" &&
    typeof envelope.tag === "string"
  );
}

function decodeBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (!value || decoded.toString("base64url") !== value) {
    throw new Error("Invalid base64url value.");
  }
  return decoded;
}

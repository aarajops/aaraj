import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { OrderAddressSchema, type OrderAddress } from "@aaraj/contracts";
import { readOrderPiiKeyring } from "../platform/crypto/order-pii-keyring.js";

export type OrderAddressLookups = {
  namePrefixes: string[];
  phonePrefixes: string[];
};

export function encryptOrderAddress(
  orderId: string,
  address: OrderAddress,
): string {
  const keyring = readOrderPiiKeyring();
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error("The active Order PII key is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(`aaraj/order-address/v2:${keyring.activeKeyId}:${orderId}`),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(address), "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    keyring.activeKeyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptOrderAddress(
  orderId: string,
  envelope: string,
): OrderAddress {
  const fields = envelope.split(".");
  const [version, keyId, nonceValue, ciphertextValue, tagValue, extra] = fields;
  const isLegacy = version === "v1" && fields.length === 4;
  const isKeyed =
    version === "v2" &&
    fields.length === 5 &&
    Boolean(keyId && /^[A-Za-z0-9_-]{1,32}$/.test(keyId));
  if ((!isLegacy && !isKeyed) || extra) {
    throw new Error("The saved Order address is unavailable.");
  }
  const resolvedKeyId = isLegacy ? "legacy" : keyId;
  const nonceField = isLegacy ? keyId : nonceValue;
  const ciphertextField = isLegacy ? nonceValue : ciphertextValue;
  const tagField = isLegacy ? ciphertextValue : tagValue;
  const nonce = Buffer.from(nonceField ?? "", "base64url");
  const ciphertext = Buffer.from(ciphertextField ?? "", "base64url");
  const tag = Buffer.from(tagField ?? "", "base64url");
  const key = readOrderPiiKeyring().keys.get(resolvedKeyId ?? "");
  if (!key || nonce.length !== 12 || tag.length !== 16) {
    throw new Error("The saved Order address is unavailable.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(
    Buffer.from(
      isLegacy
        ? `aaraj/order-address/v1:${orderId}`
        : `aaraj/order-address/v2:${resolvedKeyId}:${orderId}`,
    ),
  );
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return OrderAddressSchema.parse(JSON.parse(plaintext) as unknown);
}

export function makeOrderAddressLookups(
  address: Pick<OrderAddress, "recipientName" | "phone">,
): OrderAddressLookups {
  return {
    namePrefixes: prefixHashes(
      normalizeOrderAddressName(address.recipientName),
      "name",
    ),
    phonePrefixes: prefixHashes(
      normalizeOrderAddressPhone(address.phone),
      "phone",
    ),
  };
}

export function orderAddressSearchHash(
  kind: "name" | "phone",
  prefix: string,
): string {
  const stableKey = readOrderPiiKeyring().keys.get("legacy");
  if (!stableKey) throw new Error("The stable Order PII key is unavailable.");
  return createHmac("sha256", stableKey)
    .update(`aaraj/order-address/search/v1:${kind}:`)
    .update(prefix)
    .digest("hex");
}

export function normalizeOrderAddressName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeOrderAddressPhone(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[০-৯]/gu, (character) => String(character.charCodeAt(0) - 0x09e6))
    .replace(/\D/g, "");
}

export function canonicalOrderAddressPhonePrefix(value: string): string {
  return /^0\d{1,10}$/.test(value) ? `88${value}` : value;
}

function prefixHashes(value: string, kind: "name" | "phone"): string[] {
  const characters = Array.from(value);
  const hashes = new Set<string>();
  for (let length = 1; length <= characters.length; length += 1) {
    hashes.add(
      orderAddressSearchHash(kind, characters.slice(0, length).join("")),
    );
  }
  return [...hashes];
}

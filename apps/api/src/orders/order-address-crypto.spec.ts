import { createCipheriv, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptOrderAddress,
  encryptOrderAddress,
  makeOrderAddressLookups,
  orderAddressSearchHash,
} from "./order-address-crypto.js";

const priorKeyring = process.env.ORDER_PII_KEYRING;
const priorLegacyKey = process.env.ORDER_PII_ENCRYPTION_KEY;

afterEach(() => {
  if (priorKeyring === undefined) delete process.env.ORDER_PII_KEYRING;
  else process.env.ORDER_PII_KEYRING = priorKeyring;
  if (priorLegacyKey === undefined) delete process.env.ORDER_PII_ENCRYPTION_KEY;
  else process.env.ORDER_PII_ENCRYPTION_KEY = priorLegacyKey;
});

describe("order address encryption", () => {
  it("authenticates the order identity and decrypts across active-key rotation", () => {
    const legacy = randomBytes(32).toString("base64url");
    const rotated = randomBytes(32).toString("base64url");
    delete process.env.ORDER_PII_ENCRYPTION_KEY;
    process.env.ORDER_PII_KEYRING = JSON.stringify({
      activeKeyId: "legacy",
      keys: { legacy, rotated },
    });
    const address = {
      recipientName: "Aminul Haque",
      phone: "+8801712345678",
      geographyVersion: "BD_E2E_V1",
      divisionId: "11111111-1111-4111-8111-111111111111",
      divisionName: "Dhaka",
      districtId: "22222222-2222-4222-8222-222222222222",
      districtName: "Dhaka",
      upazilaId: null,
      upazilaName: null,
      doorstepDetails: "House 12, Road 4",
      street: null,
      house: null,
      postalCode: null,
      instructions: null,
    };
    const orderId = "33333333-3333-4333-8333-333333333333";
    const legacyCiphertext = encryptOrderAddress(orderId, address);
    expect(legacyCiphertext).not.toContain(address.recipientName);
    expect(legacyCiphertext).not.toContain(address.phone);
    expect(decryptOrderAddress(orderId, legacyCiphertext)).toEqual(address);
    const nonce = randomBytes(12);
    const legacyCipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(legacy, "base64url"),
      nonce,
    );
    legacyCipher.setAAD(Buffer.from(`aaraj/order-address/v1:${orderId}`));
    const legacyPayload = Buffer.concat([
      legacyCipher.update(JSON.stringify(address), "utf8"),
      legacyCipher.final(),
    ]);
    const legacyV1Envelope = [
      "v1",
      nonce.toString("base64url"),
      legacyPayload.toString("base64url"),
      legacyCipher.getAuthTag().toString("base64url"),
    ].join(".");
    expect(decryptOrderAddress(orderId, legacyV1Envelope)).toEqual(address);
    expect(() =>
      decryptOrderAddress(
        "44444444-4444-4444-8444-444444444444",
        legacyCiphertext,
      ),
    ).toThrow();

    const beforeRotationHash = orderAddressSearchHash("phone", "88017123");
    process.env.ORDER_PII_KEYRING = JSON.stringify({
      activeKeyId: "rotated",
      keys: { legacy, rotated },
    });
    const rotatedCiphertext = encryptOrderAddress(orderId, address);
    expect(rotatedCiphertext).toMatch(/^v2\.rotated\./);
    expect(decryptOrderAddress(orderId, legacyCiphertext)).toEqual(address);
    expect(decryptOrderAddress(orderId, rotatedCiphertext)).toEqual(address);
    expect(orderAddressSearchHash("phone", "88017123")).toBe(
      beforeRotationHash,
    );

    const lookups = makeOrderAddressLookups(address);
    expect(lookups.phonePrefixes).toContain(
      orderAddressSearchHash("phone", "8801712345678"),
    );
    expect(lookups.namePrefixes).toContain(
      orderAddressSearchHash("name", "aminul haque"),
    );
  });
});

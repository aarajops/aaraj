import { describe, expect, it, vi } from "vitest";
import { backfillOrderAddressCiphertext } from "./backfill-order-address-ciphertext.mjs";

const address = {
  recipientName: "Migration Recipient",
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

describe("Order address ciphertext migration", () => {
  it("encrypts and scrubs plaintext rows in one transaction", async () => {
    const rows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        address_snapshot: address,
        address_ciphertext: null,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        address_snapshot: {},
        address_ciphertext: "v2.legacy.nonce.ciphertext.tag",
      },
    ];
    const queries: Array<{ statement: string; parameters?: unknown[] }> = [];
    let selected = false;
    const client = {
      query: vi.fn(async (statement: string, parameters?: unknown[]) => {
        queries.push({ statement, parameters });
        if (statement.includes('SELECT "id", "address_snapshot"')) {
          if (selected) return { rows: [] };
          selected = true;
          return { rows };
        }
        if (statement.includes("SELECT count(*)::integer")) {
          return { rows: [{ count: 0 }] };
        }
        return { rows: [] };
      }),
    };
    const crypto = {
      encryptOrderAddress: vi.fn((orderId: string) => `encrypted:${orderId}`),
      decryptOrderAddress: vi.fn(() => address),
      makeOrderAddressLookups: vi.fn(() => ({
        namePrefixes: ["name-hash"],
        phonePrefixes: ["phone-hash"],
      })),
    };

    await expect(backfillOrderAddressCiphertext(client, crypto)).resolves.toBe(
      2,
    );

    const updates = queries.filter(({ statement }) =>
      statement.includes('SET "address_ciphertext"'),
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]?.parameters).toEqual([
      rows[0]?.id,
      `encrypted:${rows[0]?.id}`,
      ["name-hash"],
      ["phone-hash"],
    ]);
    expect(updates[1]?.parameters).toEqual([
      rows[1]?.id,
      `encrypted:${rows[1]?.id}`,
      ["name-hash"],
      ["phone-hash"],
    ]);
    expect(
      queries.some(({ statement }) => statement.includes("ENABLE TRIGGER")),
    ).toBe(true);
    expect(queries.at(-1)?.statement).toBe("COMMIT");
    expect(crypto.decryptOrderAddress).toHaveBeenCalledWith(
      rows[1]?.id,
      rows[1]?.address_ciphertext,
    );
  });

  it("rolls back when a plaintext address fails contract validation", async () => {
    const queries: string[] = [];
    let selected = false;
    const client = {
      query: vi.fn(async (statement: string) => {
        queries.push(statement);
        if (statement.includes('SELECT "id", "address_snapshot"')) {
          if (selected) return { rows: [] };
          selected = true;
          return {
            rows: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                address_snapshot: { ...address, phone: "not-a-phone" },
                address_ciphertext: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await expect(
      backfillOrderAddressCiphertext(client, {
        encryptOrderAddress: vi.fn(),
        decryptOrderAddress: vi.fn(),
        makeOrderAddressLookups: vi.fn(),
      }),
    ).rejects.toThrow();

    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });
});

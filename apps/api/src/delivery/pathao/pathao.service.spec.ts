import { describe, expect, it } from "vitest";
import type { PathaoOrderBookingSnapshot } from "../../orders/orders-pathao.port.js";
import { progressFromEvent, toProviderRequest } from "./pathao.service.js";

const order: PathaoOrderBookingSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  reference: "AA-0123456789AB",
  status: "confirmed",
  serviceability: "serviceable",
  fulfillmentStatus: "awaiting_dispatch",
  recipientName: "Aaraj Customer",
  recipientPhone: "+8801712345678",
  recipientAddress: "House 10, Road 5, Dhanmondi, Dhaka",
  customerInstructions: null,
  codAmountDueBdt: 1480,
};

const input = {
  storeId: 101,
  parcelQuantity: 1,
  parcelWeightKg: 0.5,
};

describe("Pathao booking request mapping", () => {
  it("maps customer delivery instructions to a normalized optional provider field", () => {
    const request = toProviderRequest(
      {
        ...order,
        customerInstructions: "Call at gate\n\tUse east entrance",
      },
      input,
    );

    expect(request.delivery_type).toBe(48);
    expect(request.special_instruction).toBe("Call at gate Use east entrance");
    expect(request).not.toHaveProperty("recipient_city");
    expect(request).not.toHaveProperty("recipient_zone");
    expect(request).not.toHaveProperty("recipient_area");
  });

  it("omits empty customer instructions and forwards valid order instructions", () => {
    const request = toProviderRequest(
      { ...order, customerInstructions: " \n\t " },
      input,
    );
    expect(request).not.toHaveProperty("special_instruction");

    const longInstruction = "x".repeat(201);
    const requestWithLongInstruction = toProviderRequest(
      { ...order, customerInstructions: longInstruction },
      input,
    );
    expect(requestWithLongInstruction.special_instruction).toBe(
      longInstruction,
    );
  });
});

describe("Pathao tracking status mapping", () => {
  it("preserves delivery failure as its own tracking state", () => {
    expect(progressFromEvent("order.delivery-failed")).toBe("delivery_failed");
  });
});

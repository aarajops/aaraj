import { describe, expect, it } from "vitest";
import type { PathaoOrderBookingSnapshot } from "../../orders/orders-pathao.port.js";
import {
  pathaoEventFromStatus,
  progressFromEvent,
  progressFromStatus,
  toProviderRequest,
} from "./pathao.service.js";

const order: PathaoOrderBookingSnapshot = {
  id: "00000000-0000-4000-8000-000000000001",
  reference: "AA-0123456789AB",
  status: "confirmed",
  fulfillmentStatus: "awaiting_dispatch",
  recipientName: "Aaraj Customer",
  recipientPhone: "+8801712345678",
  recipientAddress: "House 10, Road 5, Dhanmondi, Dhaka",
  customerInstructions: null,
  itemQuantity: 1,
  codAmountDueBdt: 1480,
};

describe("Pathao booking request mapping", () => {
  it("maps customer delivery instructions to a normalized optional provider field", () => {
    const request = toProviderRequest(
      {
        ...order,
        itemQuantity: 3,
        customerInstructions: "Call at gate\n\tUse east entrance",
      },
      101,
    );

    expect(request.delivery_type).toBe(48);
    expect(request.item_quantity).toBe(3);
    expect(request.item_weight).toBe(0.5);
    expect(request.special_instruction).toBe("Call at gate Use east entrance");
    expect(request).not.toHaveProperty("recipient_city");
    expect(request).not.toHaveProperty("recipient_zone");
    expect(request).not.toHaveProperty("recipient_area");
  });

  it("omits empty customer instructions and forwards valid order instructions", () => {
    const request = toProviderRequest(
      { ...order, customerInstructions: " \n\t " },
      101,
    );
    expect(request).not.toHaveProperty("special_instruction");

    const longInstruction = "x".repeat(201);
    const requestWithLongInstruction = toProviderRequest(
      { ...order, customerInstructions: longInstruction },
      101,
    );
    expect(requestWithLongInstruction.special_instruction).toBe(
      longInstruction,
    );
  });
});

describe("Pathao tracking status mapping", () => {
  it("preserves delivery failure as its own tracking state", () => {
    expect(progressFromEvent("order.delivery-failed")).toBe("delivery_failed");
    expect(progressFromEvent("order.pickup-failed")).toBe("pickup_failed");
    expect(progressFromStatus("Pickup Failed")).toBe("pickup_failed");
  });

  it("maps the documented Paid Return status to the returned shipment state", () => {
    expect(pathaoEventFromStatus("Paid Return")).toBe("order.paid-return");
    expect(pathaoEventFromStatus("Paid")).toBe("order.paid");
    expect(progressFromStatus("Paid Return")).toBe("returned");
    expect(pathaoEventFromStatus("Unexpected status")).toBeNull();
  });

  it("maps Pickup_On_Hold to the existing on-hold shipment state", () => {
    expect(pathaoEventFromStatus("Pickup_On_Hold")).toBe("order.on-hold");
    expect(progressFromStatus("Pickup_On_Hold")).toBe("on_hold");
  });
});

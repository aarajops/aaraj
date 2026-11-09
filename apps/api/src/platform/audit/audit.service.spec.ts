import type { DatabaseService } from "../database/database.service.js";
import { auditEvent } from "./audit-schema.js";
import { AuditService, type AuditEventInput } from "./audit.service.js";
import type { AuditTransaction } from "./audit.types.js";

describe("AuditService", () => {
  it("appends the event through the caller transaction", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "audit-event-id" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const transaction = { insert } as unknown as AuditTransaction;
    const event: AuditEventInput = {
      actorType: "user",
      actorId: "staff-user-id",
      eventType: "access.staff_role.granted",
      subjectType: "user",
      subjectId: "target-user-id",
      reason: "Support onboarding",
      metadata: { role: "staff" },
    };

    const service = new AuditService({} as DatabaseService);
    await expect(service.append(transaction, event)).resolves.toBe(
      "audit-event-id",
    );
    expect(insert).toHaveBeenCalledWith(auditEvent);
    expect(values).toHaveBeenCalledWith({
      actorType: "user",
      actorId: "staff-user-id",
      eventType: "access.staff_role.granted",
      subjectType: "user",
      subjectId: "target-user-id",
      requestId: undefined,
      reason: "Support onboarding",
      metadata: { role: "staff" },
    });
  });

  it("appends a batch with one insert through the caller transaction", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: "first-audit-event" },
        { id: "second-audit-event" },
      ]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const transaction = { insert } as unknown as AuditTransaction;
    const events: AuditEventInput[] = [
      {
        actorType: "service",
        eventType: "commerce.pathao_booking_interrupted",
        subjectType: "order",
        subjectId: "first-order-id",
        reason: "The request did not reach a durable result.",
        metadata: { bookingId: "first-booking-id" },
      },
      {
        actorType: "service",
        eventType: "commerce.pathao_booking_interrupted",
        subjectType: "order",
        subjectId: "second-order-id",
        reason: "The request did not reach a durable result.",
        metadata: { bookingId: "second-booking-id" },
      },
    ];

    const service = new AuditService({} as DatabaseService);
    await expect(service.appendMany(transaction, events)).resolves.toEqual([
      "first-audit-event",
      "second-audit-event",
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(auditEvent);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        actorType: "service",
        eventType: "commerce.pathao_booking_interrupted",
        subjectType: "order",
        subjectId: "first-order-id",
        metadata: { bookingId: "first-booking-id" },
      }),
      expect.objectContaining({
        actorType: "service",
        eventType: "commerce.pathao_booking_interrupted",
        subjectType: "order",
        subjectId: "second-order-id",
        metadata: { bookingId: "second-booking-id" },
      }),
    ]);
  });
});

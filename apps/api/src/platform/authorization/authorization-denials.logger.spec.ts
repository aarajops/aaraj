import { Logger } from "@nestjs/common";
import {
  AuthorizationEvents,
  type AuthorizationEvent,
} from "@nestjs/authorization";
import { Subject } from "rxjs";
import { AuthorizationDenialsLogger } from "./authorization-denials.logger.js";

const { recordAuditEvent } = vi.hoisted(() => ({
  recordAuditEvent: vi.fn().mockResolvedValue("audit-event-id"),
}));

vi.mock("../audit/audit.service.js", () => ({ recordAuditEvent }));

describe("AuthorizationDenialsLogger", () => {
  it("logs and records redacted denial context", () => {
    const events = new Subject<AuthorizationEvent>();
    const authorizationEvents = {
      events$: events.asObservable(),
    } as AuthorizationEvents;
    const warning = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const logger = new AuthorizationDenialsLogger(authorizationEvents);

    logger.onModuleInit();
    events.next({
      type: "denied",
      policy: "OrderPolicy",
      ability: "refund",
      reason: "forbidden",
      user: { id: "staff-user-id", email: "private@example.com" },
      args: [{ id: "order-id", customerEmail: "customer@example.com" }],
      handler: "OrdersController.refund",
    });

    expect(warning).toHaveBeenCalledWith("Authorization denied", {
      event: "authorization.denied",
      policy: "OrderPolicy",
      ability: "refund",
      reason: "forbidden",
      userId: "staff-user-id",
      handler: "OrdersController.refund",
    });
    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorType: "user",
      actorId: "staff-user-id",
      eventType: "authorization.denied",
      subjectType: "policy",
      subjectId: "OrderPolicy.refund",
      reason: "forbidden",
      metadata: { handler: "OrdersController.refund" },
    });

    logger.onModuleDestroy();
    warning.mockRestore();
  });
});

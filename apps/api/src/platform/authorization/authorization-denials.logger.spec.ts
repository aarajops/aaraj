import { Logger } from "@nestjs/common";
import {
  AuthorizationEvents,
  type AuthorizationEvent,
} from "@nestjs/authorization";
import { Subject } from "rxjs";
import { AuthorizationDenialsLogger } from "./authorization-denials.logger.js";

describe("AuthorizationDenialsLogger", () => {
  it("logs denial context without user records or policy arguments", () => {
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

    logger.onModuleDestroy();
    warning.mockRestore();
  });
});

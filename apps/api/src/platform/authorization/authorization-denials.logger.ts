import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  AuthorizationEvents,
  type AuthorizationEvent,
} from "@nestjs/authorization";
import type { Subscription } from "rxjs";
import { recordAuditEvent } from "../audit/audit.service.js";

@Injectable()
export class AuthorizationDenialsLogger
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AuthorizationDenialsLogger.name);
  private subscription: Subscription | undefined;

  constructor(private readonly authorizationEvents: AuthorizationEvents) {}

  onModuleInit(): void {
    this.subscription = this.authorizationEvents.events$.subscribe((event) => {
      this.logDenial(event);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private logDenial(event: AuthorizationEvent): void {
    const userId = getUserId(event.user);

    this.logger.warn("Authorization denied", {
      event: "authorization.denied",
      policy: event.policy,
      ability: event.ability,
      reason: event.reason,
      ...(userId ? { userId } : {}),
      ...(event.handler ? { handler: event.handler } : {}),
    });

    void recordAuditEvent({
      actorType: userId ? "user" : "anonymous",
      ...(userId ? { actorId: userId } : {}),
      eventType: "authorization.denied",
      subjectType: "policy",
      subjectId: `${event.policy}.${event.ability}`,
      reason: event.reason,
      metadata: event.handler ? { handler: event.handler } : {},
    }).catch((error: unknown) => {
      this.logger.error("Authorization denial audit write failed", {
        error: error instanceof Error ? error.name : "unknown error",
      });
    });
  }
}

function getUserId(user: unknown): string | undefined {
  if (typeof user !== "object" || user === null || !("id" in user)) {
    return undefined;
  }
  return typeof user.id === "string" ? user.id : undefined;
}

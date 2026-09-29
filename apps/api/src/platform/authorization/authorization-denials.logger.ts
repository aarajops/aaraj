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
  }
}

function getUserId(user: unknown): string | undefined {
  if (typeof user !== "object" || user === null || !("id" in user)) {
    return undefined;
  }

  return typeof user.id === "string" ? user.id : undefined;
}

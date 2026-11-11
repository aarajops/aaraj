import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, lt, lte, sql } from "drizzle-orm";
import twilio from "twilio";
import { AuthorizationService } from "@nestjs/authorization";
import {
  OrderNotificationSchema,
  type OrderNotification,
  type OrderNotifications,
  type ResolveOrderNotificationInput,
} from "@aaraj/contracts";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { decryptOrderAddress } from "./order-address-crypto.js";
import {
  customerOrder,
  orderNotificationConsentRevocation,
  orderNotificationOutbox,
} from "./orders-schema.js";

const MAX_BATCH_SIZE = 10;
const STALE_CLAIM_MS = 2 * 60_000;
const TWILIO_ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const TWILIO_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const TWILIO_MESSAGE_SID = /^SM[0-9a-fA-F]{32}$/;

type TwilioConfiguration = {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  from?: string;
  callbackUrl: string;
};

type ClaimedNotification = {
  id: string;
  orderId: string;
  eventKey: string;
  attemptCount: number;
};

@Injectable()
export class OrderNotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {
    if (process.env.NODE_ENV !== "test") readTwilioConfiguration(process.env);
  }

  async list(actor: AccessPrincipal): Promise<OrderNotifications> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const rows = await this.database.db
      .select({
        notification: orderNotificationOutbox,
        orderReference: customerOrder.reference,
      })
      .from(orderNotificationOutbox)
      .innerJoin(
        customerOrder,
        eq(customerOrder.id, orderNotificationOutbox.orderId),
      )
      .orderBy(
        desc(orderNotificationOutbox.updatedAt),
        desc(orderNotificationOutbox.id),
      )
      .limit(500);
    return rows.map(({ notification, orderReference }) =>
      OrderNotificationSchema.parse({
        id: notification.id,
        orderId: notification.orderId,
        orderReference,
        eventKey: notification.eventKey,
        status: notification.status,
        attemptCount: notification.attemptCount,
        providerMessageSid: notification.providerMessageSid,
        providerStatus: notification.providerStatus,
        lastErrorCode: notification.lastErrorCode,
        createdAt: notification.createdAt.toISOString(),
        updatedAt: notification.updatedAt.toISOString(),
      }),
    );
  }

  async resolve(
    actor: AccessPrincipal,
    notificationId: string,
    input: ResolveOrderNotificationInput,
  ): Promise<OrderNotification> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const fingerprint = requestFingerprint({ notificationId, ...input });
    const [saved] = await this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.commandId}, 0))`,
      );
      const [row] = await transaction
        .select({
          notification: orderNotificationOutbox,
          orderReference: customerOrder.reference,
        })
        .from(orderNotificationOutbox)
        .innerJoin(
          customerOrder,
          eq(customerOrder.id, orderNotificationOutbox.orderId),
        )
        .where(eq(orderNotificationOutbox.id, notificationId))
        .for("update")
        .limit(1);
      if (!row) throw notificationNotFound();
      if (
        row.notification.resolutionCommandId === input.commandId &&
        row.notification.resolutionFingerprint === fingerprint
      )
        return [row] as const;
      if (
        !["unknown", "failed"].includes(row.notification.status) ||
        (input.resolution === "confirmed_not_sent" &&
          row.notification.providerMessageSid)
      ) {
        throw new ConflictException(
          "Only an unresolved or definitively rejected SMS can be reviewed.",
          {
            errorCode: "ORDER_NOTIFICATION_NOT_RESOLVABLE",
          },
        );
      }
      const [updated] = await transaction
        .update(orderNotificationOutbox)
        .set({
          status:
            input.resolution === "confirmed_sent" ? "accepted" : "pending",
          availableAt: sql`clock_timestamp()`,
          lockedAt: null,
          lastErrorCode: null,
          providerStatus:
            input.resolution === "confirmed_sent"
              ? "operator_confirmed_sent"
              : null,
          resolutionCommandId: input.commandId,
          resolutionFingerprint: fingerprint,
          resolutionReason: input.reason,
          resolvedBy: actor.id,
          resolvedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderNotificationOutbox.id, notificationId))
        .returning({ occurredAt: orderNotificationOutbox.updatedAt });
      if (!updated) throw notificationNotFound();
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType:
          input.resolution === "confirmed_sent"
            ? "commerce.order_sms_ambiguity_confirmed_sent"
            : "commerce.order_sms_ambiguity_confirmed_not_sent",
        subjectType: "order_notification",
        subjectId: notificationId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          orderId: row.notification.orderId,
          eventKey: row.notification.eventKey,
          priorStatus: row.notification.status,
          requeued: input.resolution === "confirmed_not_sent",
        },
      });
      return [
        {
          notification: {
            ...row.notification,
            status:
              input.resolution === "confirmed_sent" ? "accepted" : "pending",
            providerStatus:
              input.resolution === "confirmed_sent"
                ? "operator_confirmed_sent"
                : null,
            lastErrorCode: null,
            updatedAt: updated.occurredAt,
          },
          orderReference: row.orderReference,
        },
      ] as const;
    });
    return OrderNotificationSchema.parse({
      id: saved.notification.id,
      orderId: saved.notification.orderId,
      orderReference: saved.orderReference,
      eventKey: saved.notification.eventKey,
      status: saved.notification.status,
      attemptCount: saved.notification.attemptCount,
      providerMessageSid: saved.notification.providerMessageSid,
      providerStatus: saved.notification.providerStatus,
      lastErrorCode: saved.notification.lastErrorCode,
      createdAt: saved.notification.createdAt.toISOString(),
      updatedAt: saved.notification.updatedAt.toISOString(),
    });
  }

  async receiveTwilioStatus(
    request: Request,
    signature: string | undefined,
    notificationId: string | undefined,
  ): Promise<void> {
    const configuration = readTwilioConfiguration(process.env);
    if (
      !configuration ||
      !signature ||
      !notificationId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        notificationId,
      )
    )
      throw new ForbiddenException("Invalid SMS provider callback.");
    const params =
      request.body && typeof request.body === "object"
        ? Object.fromEntries(
            Object.entries(request.body as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {};
    if (
      !twilio.validateRequest(
        configuration.authToken,
        signature,
        callbackUrl(configuration, notificationId),
        params,
      ) ||
      params.AccountSid !== configuration.accountSid ||
      typeof params.MessageSid !== "string" ||
      !TWILIO_MESSAGE_SID.test(params.MessageSid)
    ) {
      throw new ForbiddenException("Invalid SMS provider callback.");
    }
    const providerStatus = params.MessageStatus ?? params.SmsStatus;
    if (typeof providerStatus !== "string")
      throw new ForbiddenException("Invalid SMS provider callback.");
    const mappedStatus = mapTwilioStatus(providerStatus);
    if (!mappedStatus) return;

    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(orderNotificationOutbox)
        .where(eq(orderNotificationOutbox.id, notificationId))
        .for("update")
        .limit(1);
      if (!row) return;
      if (
        (row.status !== "sending" &&
          row.status !== "unknown" &&
          row.status !== "accepted" &&
          row.status !== "delivered" &&
          row.status !== "failed") ||
        (row.providerMessageSid !== null &&
          row.providerMessageSid !== params.MessageSid)
      )
        return;
      if (
        row.status === "delivered" ||
        (row.status === "failed" && mappedStatus !== "delivered")
      )
        return;
      if (row.status === mappedStatus && row.providerStatus === providerStatus)
        return;
      const [updated] = await transaction
        .update(orderNotificationOutbox)
        .set({
          status: mappedStatus,
          providerMessageSid: params.MessageSid,
          providerStatus: providerStatus.slice(0, 40),
          lastErrorCode:
            mappedStatus === "failed"
              ? `TWILIO_${String(params.ErrorCode ?? "FAILED")
                  .replace(/[^A-Z0-9_]/gi, "_")
                  .toUpperCase()
                  .slice(0, 60)}`
              : null,
          lockedAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderNotificationOutbox.id, row.id))
        .returning({ occurredAt: orderNotificationOutbox.updatedAt });
      if (!updated) return;
      await this.audit.append(transaction, {
        actorType: "service",
        eventType: "commerce.order_sms_provider_status",
        subjectType: "order_notification",
        subjectId: row.id,
        occurredAt: updated.occurredAt,
        reason: "Authenticated SMS delivery status callback received.",
        metadata: {
          orderId: row.orderId,
          eventKey: row.eventKey,
          providerMessageSid: params.MessageSid,
          providerStatus,
          status: mappedStatus,
        },
      });
    });
  }

  async dispatchPending(): Promise<number> {
    const configuration = readTwilioConfiguration(process.env);
    if (!configuration) return 0;
    await this.markStaleSendingUnknown();
    const claimed = await this.claimPending();
    for (const notification of claimed) {
      await this.sendOne(notification, configuration);
    }
    return claimed.length;
  }

  private async claimPending(): Promise<ClaimedNotification[]> {
    return this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: orderNotificationOutbox.id,
          orderId: orderNotificationOutbox.orderId,
          eventKey: orderNotificationOutbox.eventKey,
          attemptCount: orderNotificationOutbox.attemptCount,
        })
        .from(orderNotificationOutbox)
        .where(
          and(
            eq(orderNotificationOutbox.status, "pending"),
            lte(orderNotificationOutbox.availableAt, sql`clock_timestamp()`),
          ),
        )
        .orderBy(
          asc(orderNotificationOutbox.availableAt),
          asc(orderNotificationOutbox.createdAt),
        )
        .limit(MAX_BATCH_SIZE)
        .for("update", { skipLocked: true });
      const claimed: ClaimedNotification[] = [];
      for (const row of rows) {
        const [updated] = await transaction
          .update(orderNotificationOutbox)
          .set({
            status: "sending",
            attemptCount: row.attemptCount + 1,
            lockedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(orderNotificationOutbox.id, row.id))
          .returning({ attemptCount: orderNotificationOutbox.attemptCount });
        if (updated)
          claimed.push({ ...row, attemptCount: updated.attemptCount });
      }
      return claimed;
    });
  }

  private async sendOne(
    notification: ClaimedNotification,
    configuration: TwilioConfiguration,
  ): Promise<void> {
    const [order] = await this.database.db
      .select({
        reference: customerOrder.reference,
        addressCiphertext: customerOrder.addressCiphertext,
        smsUpdatesConsent: customerOrder.smsUpdatesConsent,
        consentRevoked: sql<boolean>`exists (select 1 from ${orderNotificationConsentRevocation} where ${orderNotificationConsentRevocation.orderId} = ${customerOrder.id})`,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, notification.orderId))
      .limit(1);
    if (!order || !order.smsUpdatesConsent || order.consentRevoked) {
      await this.saveSendResult(notification, {
        status: "suppressed",
        providerStatus: "consent_missing",
        errorCode: null,
      });
      return;
    }
    const address = decryptOrderAddress(
      notification.orderId,
      order.addressCiphertext,
    );
    const client = twilio(configuration.accountSid, configuration.authToken, {
      timeout: 15_000,
      autoRetry: false,
    });
    let acceptedMessageSid: string | undefined;
    try {
      const message = await client.messages.create({
        to: address.phone,
        body: messageBody(notification.eventKey, order.reference),
        ...(configuration.messagingServiceSid
          ? { messagingServiceSid: configuration.messagingServiceSid }
          : { from: configuration.from! }),
        statusCallback: callbackUrl(configuration, notification.id),
      });
      if (!TWILIO_MESSAGE_SID.test(message.sid))
        throw new Error("invalid_provider_sid");
      acceptedMessageSid = message.sid;
      const status = mapTwilioStatus(message.status) ?? "accepted";
      await this.saveSendResult(notification, {
        status,
        providerStatus: message.status,
        providerMessageSid: message.sid,
        errorCode: status === "failed" ? "TWILIO_SEND_REJECTED" : null,
      });
    } catch (error) {
      const httpStatus =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: unknown }).status)
          : undefined;
      const definitiveRejection =
        Number.isInteger(httpStatus) && httpStatus! >= 400 && httpStatus! < 500;
      await this.saveSendResult(notification, {
        status: definitiveRejection ? "failed" : "unknown",
        providerStatus: definitiveRejection
          ? "provider_rejected"
          : "provider_outcome_ambiguous",
        ...(acceptedMessageSid
          ? { providerMessageSid: acceptedMessageSid }
          : {}),
        errorCode: definitiveRejection
          ? `TWILIO_HTTP_${httpStatus}`
          : "TWILIO_OUTCOME_UNKNOWN",
      });
    }
  }

  private async saveSendResult(
    notification: ClaimedNotification,
    result: {
      status: "accepted" | "delivered" | "failed" | "unknown" | "suppressed";
      providerStatus: string;
      providerMessageSid?: string;
      errorCode: string | null;
    },
  ): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(orderNotificationOutbox)
        .set({
          status: result.status,
          providerStatus: result.providerStatus.slice(0, 40),
          ...(result.providerMessageSid
            ? { providerMessageSid: result.providerMessageSid }
            : {}),
          lastErrorCode: result.errorCode,
          lockedAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(orderNotificationOutbox.id, notification.id),
            eq(orderNotificationOutbox.status, "sending"),
          ),
        )
        .returning({ occurredAt: orderNotificationOutbox.updatedAt });
      if (!updated) return;
      await this.audit.append(transaction, {
        actorType: "service",
        eventType: `commerce.order_sms_${result.status}`,
        subjectType: "order_notification",
        subjectId: notification.id,
        occurredAt: updated.occurredAt,
        reason: "Transactional order SMS processing result recorded.",
        metadata: {
          orderId: notification.orderId,
          eventKey: notification.eventKey,
          attemptCount: notification.attemptCount,
          status: result.status,
          providerStatus: result.providerStatus,
          ...(result.providerMessageSid
            ? { providerMessageSid: result.providerMessageSid }
            : {}),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        },
      });
    });
  }

  private async markStaleSendingUnknown(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    await this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: orderNotificationOutbox.id,
          orderId: orderNotificationOutbox.orderId,
          eventKey: orderNotificationOutbox.eventKey,
        })
        .from(orderNotificationOutbox)
        .where(
          and(
            eq(orderNotificationOutbox.status, "sending"),
            lt(orderNotificationOutbox.lockedAt, staleBefore),
          ),
        )
        .for("update", { skipLocked: true });
      for (const row of rows) {
        const [updated] = await transaction
          .update(orderNotificationOutbox)
          .set({
            status: "unknown",
            providerStatus: "worker_stopped_after_claim",
            lastErrorCode: "WORKER_OUTCOME_UNKNOWN",
            lockedAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(orderNotificationOutbox.id, row.id))
          .returning({ occurredAt: orderNotificationOutbox.updatedAt });
        if (updated)
          await this.audit.append(transaction, {
            actorType: "service",
            eventType: "commerce.order_sms_unknown",
            subjectType: "order_notification",
            subjectId: row.id,
            occurredAt: updated.occurredAt,
            reason:
              "A claimed SMS did not finish before its worker lease expired; automatic resend is blocked.",
            metadata: { orderId: row.orderId, eventKey: row.eventKey },
          });
      }
    });
  }
}

export function readTwilioConfiguration(
  environment: NodeJS.ProcessEnv,
): TwilioConfiguration | null {
  const accountSid = environment.TWILIO_ACCOUNT_SID?.trim();
  const authToken = environment.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = environment.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const from = environment.TWILIO_SMS_FROM?.trim();
  const callbackUrl = environment.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (
    ![accountSid, authToken, messagingServiceSid, from, callbackUrl].some(
      Boolean,
    )
  )
    return null;
  if (
    !accountSid ||
    !TWILIO_ACCOUNT_SID.test(accountSid) ||
    !authToken ||
    authToken.length < 20 ||
    Boolean(messagingServiceSid) === Boolean(from) ||
    !callbackUrl
  ) {
    throw new Error("Twilio configuration is incomplete or invalid.");
  }
  if (messagingServiceSid && !TWILIO_SERVICE_SID.test(messagingServiceSid)) {
    throw new Error("TWILIO_MESSAGING_SERVICE_SID is invalid.");
  }
  if (
    from &&
    !(/^\+[1-9]\d{7,14}$/.test(from) || /^[A-Za-z0-9]{3,11}$/.test(from))
  ) {
    throw new Error(
      "TWILIO_SMS_FROM must be a sender phone number or registered alphanumeric sender ID.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new Error("TWILIO_STATUS_CALLBACK_URL must be absolute.");
  }
  if (
    (environment.NODE_ENV === "production" && parsed.protocol !== "https:") ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith("/api/v1/orders/notifications/twilio/status")
  ) {
    throw new Error(
      "TWILIO_STATUS_CALLBACK_URL must point to the HTTPS order SMS status callback.",
    );
  }
  return {
    accountSid,
    authToken,
    ...(messagingServiceSid ? { messagingServiceSid } : {}),
    ...(from ? { from } : {}),
    callbackUrl: parsed.toString(),
  };
}

function callbackUrl(
  configuration: TwilioConfiguration,
  notificationId: string,
): string {
  const url = new URL(configuration.callbackUrl);
  url.searchParams.set("notificationId", notificationId);
  return url.toString();
}

function mapTwilioStatus(
  status: string,
): "accepted" | "delivered" | "failed" | null {
  switch (status.toLowerCase()) {
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":
    case "sent":
      return "accepted";
    case "delivered":
      return "delivered";
    case "failed":
    case "undelivered":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

function messageBody(eventKey: string, orderReference: string): string {
  const messages: Record<string, string> = {
    order_received: `AARAJ: We received order ${orderReference}. We will confirm it shortly.`,
    order_confirmed: `AARAJ: Order ${orderReference} is confirmed. We will share delivery updates.`,
    order_cancelled: `AARAJ: Order ${orderReference} was cancelled. Contact support if this is unexpected.`,
    order_dispatched: `AARAJ: Order ${orderReference} has been handed to the courier.`,
    order_partially_delivered: `AARAJ: Part of order ${orderReference} was delivered. Contact support for help.`,
    order_delivered: `AARAJ: Order ${orderReference} was recorded as delivered. Thank you.`,
    order_delivery_issue: `AARAJ: The courier reported an issue with order ${orderReference}. Contact support for help.`,
    order_returned: `AARAJ: Order ${orderReference} was recorded as returned. Contact support for help.`,
  };
  return (
    messages[eventKey] ??
    `AARAJ: There is an update to order ${orderReference}. Contact support for help.`
  );
}

function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function notificationNotFound() {
  return new NotFoundException("Order notification not found.", {
    errorCode: "ORDER_NOTIFICATION_NOT_FOUND",
  });
}

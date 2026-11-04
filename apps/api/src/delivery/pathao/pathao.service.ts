import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  PathaoBookingManagementSchema,
  PathaoBookingSchema,
  PathaoCustomerTrackingSchema,
  PathaoCustomerTrackingLookupSchema,
  PathaoManagementBookingSummariesSchema,
  PathaoManagementIssuesSchema,
  MAX_LIST_OFFSET,
  PathaoManualReconciliationInputSchema,
  PathaoWebhookResolutionInputSchema,
  PathaoWebhookResolutionResultSchema,
  PATHAO_MINIMUM_ITEM_WEIGHT_KG,
  type PathaoBooking,
  type PathaoBookingManagement,
  type PathaoCustomerTracking,
  type PathaoCustomerTrackingLookup,
  type PathaoDeliveryType,
  type PathaoManagementIssues,
  type PathaoManagementIssuesQuery,
  type PathaoManualReconciliationInput,
  type PathaoWebhookResolutionInput,
  type PathaoWebhookResolutionResult,
  type PathaoWebhookObservation,
} from "@aaraj/contracts";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../../platform/database/database.service.js";
import { AuditService } from "../../platform/audit/audit.service.js";
import type { AuditTransaction } from "../../platform/audit/audit.types.js";
import {
  ORDERS_PATHAO_PORT,
  type PathaoBookingClaimStatus,
  type OrdersPathaoPort,
} from "../../orders/orders-pathao.port.js";
import {
  pathaoBooking,
  pathaoWebhookInbox,
  pathaoWebhookResolution,
} from "./pathao-schema.js";
import {
  PathaoApiClient,
  PathaoRequestError,
  type PathaoBookingRequest,
  type PathaoStoreRecord,
} from "./pathao-api.client.js";
import {
  readPathaoConfiguration,
  type PathaoConfiguration,
} from "./pathao-config.js";
import { PathaoTokenService } from "./pathao-token.service.js";

const PATHAO_NORMAL_DELIVERY_TYPE = 48 satisfies PathaoDeliveryType;
const PATHAO_PARCEL_ITEM_TYPE = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PathaoWebhookBodySchema = z.object({
  event: z.string().trim().min(1).max(80),
  consignment_id: z.string().trim().min(1).max(120).optional(),
  merchant_order_id: z.string().trim().min(1).max(100).optional(),
  timestamp: z.string().trim().min(1).max(64).optional(),
  updated_at: z.string().trim().min(1).max(64).optional(),
  order_status: z.string().trim().min(1).max(100).optional(),
  store_id: z.number().int().positive().max(2_147_483_647).optional(),
  delivery_fee: z.number().nonnegative().optional(),
  collected_amount: z.number().nonnegative().optional(),
});

type PathaoCancellationResult =
  | { booking: typeof pathaoBooking.$inferSelect; blockedReason: null }
  | { booking: null; blockedReason: "after_pickup" | "after_dispatch" };

const PATHAO_ORDER_EVENTS = new Set([
  "order.created",
  "order.updated",
  "order.pickup-requested",
  "order.assigned-for-pickup",
  "order.picked",
  "order.pickup-failed",
  "order.pickup-cancelled",
  "order.at-the-sorting-hub",
  "order.in-transit",
  "order.received-at-last-mile-hub",
  "order.assigned-for-delivery",
  "order.on-hold",
  "order.delivered",
  "order.partial-delivery",
  "order.delivery-failed",
  "order.returned",
  "order.return-id-created",
  "order.return-in-transit",
  "order.returned-to-merchant",
  "order.paid-return",
  "order.exchanged",
  "order.paid",
]);

const PATHAO_STATUS_EVENTS: Readonly<Record<string, string>> = {
  pending: "order.created",
  created: "order.created",
  ordercreated: "order.created",
  pickuprequested: "order.pickup-requested",
  assignedforpickup: "order.assigned-for-pickup",
  picked: "order.picked",
  pickupfailed: "order.pickup-failed",
  pickupcancelled: "order.pickup-cancelled",
  atthesortinghub: "order.at-the-sorting-hub",
  intransit: "order.in-transit",
  receivedatlastmilehub: "order.received-at-last-mile-hub",
  assignedfordelivery: "order.assigned-for-delivery",
  delivered: "order.delivered",
  partialdelivery: "order.partial-delivery",
  deliveryfailed: "order.delivery-failed",
  onhold: "order.on-hold",
  return: "order.returned",
  returned: "order.returned",
  returnidcreated: "order.return-id-created",
  returnintransit: "order.return-in-transit",
  returnedtomerchant: "order.returned-to-merchant",
  paidreturn: "order.paid-return",
  exchange: "order.exchanged",
  exchanged: "order.exchanged",
};

type Progress = PathaoBooking["trackingProgress"];
type InboxRow = typeof pathaoWebhookInbox.$inferSelect;

@Injectable()
export class PathaoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly api: PathaoApiClient,
    private readonly tokens: PathaoTokenService,
    @Inject(ORDERS_PATHAO_PORT) private readonly orders: OrdersPathaoPort,
  ) {}

  async createBooking(
    orderId: string,
    staffId: string,
    rawCommandId: string,
  ): Promise<PathaoBooking> {
    const commandId = rawCommandId.toLowerCase();
    if (!UUID_PATTERN.test(commandId)) {
      throw new UnprocessableEntityException(
        "A valid booking command is required.",
        {
          errorCode: "PATHAO_BOOKING_COMMAND_REQUIRED",
        },
      );
    }
    const existing = await this.findBooking(orderId);
    if (existing && existing.status !== "cancelled") {
      const replay = this.assertReplay(existing, commandId);
      await this.ensureBookingClaim(existing);
      return replay;
    }
    const config = requiredPathaoConfiguration();
    const deliveryType = PATHAO_NORMAL_DELIVERY_TYPE;
    const bookingSnapshot = await this.orders.getPathaoBookingSnapshot(orderId);
    const { config: authenticatedConfig, accessToken } =
      await this.tokens.getAccessToken();
    const stores = await this.api.listStores(authenticatedConfig, accessToken);
    const store = selectDefaultActiveStore(stores);
    if (!store) {
      throw new ServiceUnavailableException(
        "Set one active default Pathao pickup store in the Merchant Panel.",
        { errorCode: "PATHAO_DEFAULT_STORE_UNAVAILABLE" },
      );
    }
    const itemQuantity = bookingSnapshot.itemQuantity;
    const parcelWeightKg = PATHAO_MINIMUM_ITEM_WEIGHT_KG;
    const fingerprint = bookingFingerprint({
      orderId,
      storeId: store.storeId,
      deliveryType,
      parcelQuantity: itemQuantity,
      parcelWeightKg,
    });
    const order = await this.orders.beginPathaoBookingClaim(
      orderId,
      commandId,
      fingerprint,
      "submitting",
    );
    const providerRequest = toProviderRequest(order, store.storeId);
    const bookingId = randomUUID();
    let created: typeof pathaoBooking.$inferSelect | null = null;
    try {
      created = await this.database.db.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(pathaoBooking)
          .values({
            id: bookingId,
            orderId,
            environment: config.mode,
            storeId: store.storeId,
            deliveryType,
            parcelQuantity: order.itemQuantity,
            parcelWeightKg,
            merchantOrderId: order.reference,
            commandId,
            requestFingerprint: fingerprint,
            status: "submitting",
            createdBy: staffId,
            submittedAt: sql`clock_timestamp()`,
          })
          .returning();
        if (!row) throw new Error("Pathao booking command was not persisted.");
        await this.appendAudit(transaction, {
          actorId: staffId,
          eventType: "commerce.pathao_booking_requested",
          orderId,
          reason: "Authorized staff requested a Pathao COD consignment.",
          metadata: {
            bookingId: row.id,
            commandId,
            environment: config.mode,
            storeId: store.storeId,
            deliveryType,
            parcelQuantity: order.itemQuantity,
            parcelWeightKg,
          },
        });
        return row;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findBooking(orderId);
      if (!existing) throw error;
      return this.assertReplay(existing, commandId);
    }

    if (!created) throw new Error("Pathao booking command was not persisted.");
    try {
      await this.orders.assertPathaoBookingClaim(
        orderId,
        commandId,
        fingerprint,
      );
      const result = await this.api.createOrder(
        config,
        accessToken,
        providerRequest,
      );
      const status =
        result.merchantOrderId !== null &&
        result.merchantOrderId !== order.reference
          ? "reconciliation_required"
          : "booked";
      const [updated] = await this.database.db.transaction(
        async (transaction) => {
          const [row] = await transaction
            .update(pathaoBooking)
            .set({
              status,
              consignmentId: status === "booked" ? result.consignmentId : null,
              providerOrderStatus: result.orderStatus,
              deliveryFeeBdt: result.deliveryFeeBdt,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(
              and(
                eq(pathaoBooking.id, created!.id),
                eq(pathaoBooking.status, "submitting"),
              ),
            )
            .returning();
          if (!row)
            throw new Error("Pathao booking command changed unexpectedly.");
          await this.appendAudit(transaction, {
            actorId: staffId,
            eventType:
              status === "booked"
                ? "commerce.pathao_booking_confirmed"
                : "commerce.pathao_booking_reconciliation_required",
            orderId,
            reason:
              status === "booked"
                ? "Pathao returned a consignment booking result."
                : "Pathao response did not match the AARAJ merchant reference.",
            metadata: {
              bookingId: row.id,
              commandId,
              consignmentId: status === "booked" ? result.consignmentId : null,
              deliveryFeeBdt: result.deliveryFeeBdt,
            },
          });
          if (status === "booked" && result.consignmentId) {
            await this.attachUnmatchedWebhooks(
              transaction,
              row.id,
              config.mode,
              result.consignmentId,
            );
          }
          return [row] as const;
        },
      );
      await this.orders.setPathaoBookingClaim({
        orderId,
        commandId,
        requestFingerprint: fingerprint,
        status,
        lastErrorCode: updated.lastErrorCode,
      });
      return toBooking(updated);
    } catch (error) {
      await this.markUnknown(created.id, staffId, error);
      return this.getBookingById(created.id);
    }
  }

  async getManagementBooking(orderId: string): Promise<PathaoBooking | null> {
    const row = await this.findBooking(orderId);
    return row ? toBooking(row) : null;
  }

  async syncManagementBookingStatus(orderId: string): Promise<PathaoBooking> {
    const booking = await this.findBooking(orderId);
    if (!booking || booking.status !== "booked" || !booking.consignmentId) {
      if (booking?.status === "cancelled") return toBooking(booking);
      throw new ConflictException(
        "There is no active Pathao consignment to sync.",
        { errorCode: "PATHAO_BOOKING_NOT_SYNCABLE" },
      );
    }
    const config = requiredPathaoConfiguration();
    if (booking.environment !== config.mode) {
      throw new ConflictException(
        "This consignment belongs to a different Pathao environment.",
        { errorCode: "PATHAO_ENVIRONMENT_MISMATCH" },
      );
    }
    const { accessToken } = await this.tokens.getAccessToken();
    let info: Awaited<ReturnType<PathaoApiClient["getOrderInfo"]>>;
    try {
      info = await this.api.getOrderInfo(
        config,
        accessToken,
        booking.consignmentId,
      );
    } catch (error) {
      if (error instanceof PathaoRequestError) {
        throw new ServiceUnavailableException(
          "Pathao status could not be synced. The Order remains locked.",
          { errorCode: error.code },
        );
      }
      throw error;
    }
    if (
      info.consignmentId !== booking.consignmentId ||
      (info.merchantOrderId !== null &&
        info.merchantOrderId !== booking.merchantOrderId)
    ) {
      throw new ConflictException(
        "Pathao returned details for a different consignment or Order.",
        { errorCode: "PATHAO_ORDER_IDENTITY_MISMATCH" },
      );
    }
    const providerProgress = progressFromStatus(info.orderStatus);
    if (!providerProgress) {
      throw new ConflictException(
        "Pathao returned a status AARAJ cannot safely apply.",
        { errorCode: "PATHAO_STATUS_REQUIRES_REVIEW" },
      );
    }
    return this.database.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(pathaoBooking)
        .where(eq(pathaoBooking.id, booking.id))
        .for("update")
        .limit(1);
      if (
        !current ||
        current.consignmentId !== booking.consignmentId ||
        (current.status !== "booked" && current.status !== "cancelled")
      ) {
        throw new ConflictException(
          "The Pathao consignment changed while its status was syncing.",
          { errorCode: "PATHAO_BOOKING_CHANGED" },
        );
      }
      if (current.status === "cancelled") {
        if (providerProgress !== "cancelled") {
          throw new ConflictException(
            "Pathao status conflicts with the saved cancellation.",
            { errorCode: "PATHAO_STATUS_CHANGED_AFTER_CANCELLATION" },
          );
        }
        return toBooking(current);
      }
      if (providerProgress === "cancelled") {
        const result = await this.cancelBookingWithinTransaction(
          transaction,
          current,
          info.orderStatus,
          "status_sync",
        );
        if (result.blockedReason) {
          throw new ConflictException(
            "Pathao reports cancellation after pickup. The Order remains locked for review.",
            {
              errorCode:
                result.blockedReason === "after_pickup"
                  ? "PATHAO_CANCELLATION_AFTER_PICKUP_BLOCKED"
                  : "PATHAO_CANCELLATION_AFTER_DISPATCH_BLOCKED",
            },
          );
        }
        return toBooking(result.booking);
      }

      const [updated] = await transaction
        .update(pathaoBooking)
        .set({
          trackingProgress: providerProgress,
          providerOrderStatus: info.orderStatus,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(pathaoBooking.id, current.id))
        .returning();
      if (!updated) throw new Error("Pathao booking disappeared during sync.");
      return toBooking(updated);
    });
  }

  async getManagementBookingSummaries(orderIds: readonly string[]) {
    if (orderIds.length === 0) return [];
    const [bookings, claims] = await Promise.all([
      this.database.db
        .select({
          orderId: pathaoBooking.orderId,
          status: pathaoBooking.status,
          trackingProgress: pathaoBooking.trackingProgress,
          consignmentId: pathaoBooking.consignmentId,
        })
        .from(pathaoBooking)
        .where(inArray(pathaoBooking.orderId, [...orderIds]))
        .orderBy(desc(pathaoBooking.createdAt), desc(pathaoBooking.id)),
      this.orders.getPathaoBookingClaimStatuses(orderIds),
    ]);
    const bookingByOrderId = new Map<string, (typeof bookings)[number]>();
    for (const booking of bookings) {
      if (!bookingByOrderId.has(booking.orderId)) {
        bookingByOrderId.set(booking.orderId, booking);
      }
    }
    const claimStatusByOrderId = new Map(
      claims.map((claim) => [claim.orderId, claim.status]),
    );
    return PathaoManagementBookingSummariesSchema.parse(
      orderIds.map((orderId) => {
        const booking = bookingByOrderId.get(orderId);
        return {
          orderId,
          status: claimStatusByOrderId.get(orderId) ?? booking?.status ?? null,
          trackingProgress: booking?.trackingProgress ?? null,
          consignmentId: booking?.consignmentId ?? null,
        };
      }),
    );
  }

  async getManagementDetails(
    orderId: string,
  ): Promise<PathaoBookingManagement> {
    const booking = await this.findBooking(orderId);
    const claimStatus = await this.orders.getPathaoBookingClaimStatus(orderId);
    if (!booking) {
      return {
        booking: null,
        claimStatus,
        observations: [],
      };
    }
    const observations = await this.database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.bookingId, booking.id))
      .orderBy(desc(pathaoWebhookInbox.receivedAt), desc(pathaoWebhookInbox.id))
      .limit(100);
    return PathaoBookingManagementSchema.parse({
      booking: toBooking(booking),
      claimStatus,
      observations: observations.map(toObservation),
    });
  }

  async getManagementIssues(
    query: PathaoManagementIssuesQuery,
  ): Promise<PathaoManagementIssues> {
    const observations = await this.database.db
      .select({
        id: pathaoWebhookInbox.id,
        orderId: pathaoBooking.orderId,
        merchantOrderId: pathaoWebhookInbox.merchantOrderId,
        storeId: pathaoWebhookInbox.storeId,
        consignmentId: pathaoWebhookInbox.consignmentId,
        event: pathaoWebhookInbox.eventName,
        status: pathaoWebhookInbox.processingState,
        errorCode: pathaoWebhookInbox.lastErrorCode,
        providerStatus: pathaoWebhookInbox.providerOrderStatus,
        occurredAt: pathaoWebhookInbox.receivedAt,
      })
      .from(pathaoWebhookInbox)
      .leftJoin(
        pathaoBooking,
        eq(pathaoWebhookInbox.bookingId, pathaoBooking.id),
      )
      .where(
        inArray(pathaoWebhookInbox.processingState, [
          "reconciliation_required",
          "unmatched",
        ]),
      )
      .orderBy(asc(pathaoWebhookInbox.receivedAt), asc(pathaoWebhookInbox.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const hasMore = observations.length > query.limit;
    const candidates = observations.slice(0, query.limit).map((row) => ({
      id: row.id,
      orderId: row.orderId,
      consignmentId: row.consignmentId,
      merchantOrderId: row.merchantOrderId,
      storeId: row.storeId,
      event: row.event,
      status: row.status,
      errorCode: row.errorCode,
      providerStatus: row.providerStatus,
      occurredAt: row.occurredAt.toISOString(),
    }));
    const orderIds = [
      ...new Set(
        candidates.flatMap((issue) => (issue.orderId ? [issue.orderId] : [])),
      ),
    ];
    const references = await this.orders.getOrderReferences(orderIds);
    const referenceById = new Map(
      references.map((row) => [row.id, row.reference]),
    );
    const issues = candidates.map((issue) => ({
      ...issue,
      orderReference: issue.orderId
        ? (referenceById.get(issue.orderId) ?? null)
        : null,
    }));
    const candidateNextOffset = query.offset + candidates.length;
    return PathaoManagementIssuesSchema.parse({
      issues,
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    });
  }

  async resolveWebhookIssue(
    eventId: string,
    staffId: string,
    rawCommandId: string,
    rawInput: PathaoWebhookResolutionInput,
  ): Promise<PathaoWebhookResolutionResult> {
    const commandId = rawCommandId.toLowerCase();
    if (!UUID_PATTERN.test(commandId)) {
      throw new UnprocessableEntityException(
        "A valid webhook resolution command is required.",
        { errorCode: "PATHAO_WEBHOOK_RESOLUTION_COMMAND_REQUIRED" },
      );
    }
    const input = PathaoWebhookResolutionInputSchema.parse(rawInput);
    const fingerprint = sha256(JSON.stringify({ eventId, input }));

    try {
      return await this.database.db.transaction(async (transaction) => {
        const replay = await transaction
          .select()
          .from(pathaoWebhookResolution)
          .where(eq(pathaoWebhookResolution.commandId, commandId))
          .limit(1);
        if (replay[0]) {
          return this.assertWebhookResolutionReplay(
            replay[0],
            eventId,
            fingerprint,
          );
        }

        const [event] = await transaction
          .select()
          .from(pathaoWebhookInbox)
          .where(eq(pathaoWebhookInbox.id, eventId))
          .for("update")
          .limit(1);
        if (!event) throw new ConflictException("Pathao event was not found.");

        const afterLockReplay = await transaction
          .select()
          .from(pathaoWebhookResolution)
          .where(eq(pathaoWebhookResolution.commandId, commandId))
          .limit(1);
        if (afterLockReplay[0]) {
          return this.assertWebhookResolutionReplay(
            afterLockReplay[0],
            eventId,
            fingerprint,
          );
        }
        if (
          event.processingState !== "reconciliation_required" ||
          event.bookingId === null
        ) {
          throw new ConflictException(
            "Only a linked Pathao event requiring reconciliation can be resolved.",
            { errorCode: "PATHAO_WEBHOOK_RESOLUTION_NOT_ELIGIBLE" },
          );
        }
        const [booking] = await transaction
          .select({ orderId: pathaoBooking.orderId })
          .from(pathaoBooking)
          .where(eq(pathaoBooking.id, event.bookingId))
          .limit(1);
        if (!booking) {
          throw new ConflictException(
            "The Pathao event no longer has a valid booking link.",
            { errorCode: "PATHAO_WEBHOOK_RESOLUTION_NOT_ELIGIBLE" },
          );
        }

        const action = input.action;
        const resultingState = action === "recheck" ? "pending" : "ignored";
        await transaction.insert(pathaoWebhookResolution).values({
          eventId,
          commandId,
          requestFingerprint: fingerprint,
          action,
          resultingState,
          reason: input.reason,
          verifiedInPathaoPanel: action === "acknowledge_no_change",
          resolvedBy: staffId,
        });
        await transaction
          .update(pathaoWebhookInbox)
          .set({
            processingState: resultingState,
            nextAttemptAt: sql`clock_timestamp()`,
            lastErrorCode: null,
            processedAt:
              resultingState === "ignored" ? sql`clock_timestamp()` : null,
            processingLeaseExpiresAt: null,
            processingLeaseOwner: null,
          })
          .where(eq(pathaoWebhookInbox.id, eventId));
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: staffId,
          eventType: "commerce.pathao_webhook_issue_resolved",
          subjectType: "order",
          subjectId: booking.orderId,
          reason: input.reason,
          metadata: {
            webhookEventId: eventId,
            commandId,
            action,
            resultingState,
            verifiedInPathaoPanel: action === "acknowledge_no_change",
          },
        });
        return PathaoWebhookResolutionResultSchema.parse({
          eventId,
          action,
          status: resultingState,
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [existing] = await this.database.db
        .select()
        .from(pathaoWebhookResolution)
        .where(eq(pathaoWebhookResolution.commandId, commandId))
        .limit(1);
      if (existing) {
        return this.assertWebhookResolutionReplay(
          existing,
          eventId,
          fingerprint,
        );
      }
      throw new ConflictException(
        "The webhook resolution command was already used.",
        { errorCode: "PATHAO_WEBHOOK_RESOLUTION_IDEMPOTENCY_CONFLICT" },
      );
    }
  }

  async reconcileBooking(
    orderId: string,
    staffId: string,
    rawCommandId: string,
    rawInput: PathaoManualReconciliationInput,
  ): Promise<PathaoBooking> {
    const commandId = rawCommandId.toLowerCase();
    if (!UUID_PATTERN.test(commandId)) {
      throw new UnprocessableEntityException(
        "A valid reconciliation command is required.",
        { errorCode: "PATHAO_RECONCILIATION_COMMAND_REQUIRED" },
      );
    }
    const input = PathaoManualReconciliationInputSchema.parse(rawInput);
    const config = requiredPathaoConfiguration();
    const fingerprint = sha256(JSON.stringify({ orderId, input }));
    await this.expireInterruptedBookings();
    const current = await this.findBooking(orderId);
    if (
      current?.reconciliationCommandId === commandId &&
      current.reconciliationFingerprint === fingerprint
    ) {
      await this.ensureBookingClaim(current);
      if (current.status === "booked" && current.consignmentId) {
        await this.database.db.transaction((transaction) =>
          this.attachUnmatchedWebhooks(
            transaction,
            current.id,
            current.environment,
            current.consignmentId!,
          ),
        );
      }
      return toBooking(current);
    }
    if (
      current?.reconciliationCommandId === commandId &&
      current.reconciliationFingerprint !== fingerprint
    ) {
      throw new ConflictException(
        "The reconciliation command was already used with different details.",
        { errorCode: "PATHAO_RECONCILIATION_IDEMPOTENCY_CONFLICT" },
      );
    }
    if (
      current?.status === "booked" &&
      current.consignmentId === input.consignmentId
    ) {
      if (current.consignmentId) {
        await this.database.db.transaction((transaction) =>
          this.attachUnmatchedWebhooks(
            transaction,
            current.id,
            current.environment,
            current.consignmentId!,
          ),
        );
      }
      await this.ensureBookingClaim(current);
      return toBooking(current);
    }

    const { config: authenticatedConfig, accessToken } =
      await this.tokens.getAccessToken();
    let storeId = current?.storeId ?? null;
    if (storeId === null) {
      const stores = await this.api.listStores(
        authenticatedConfig,
        accessToken,
      );
      const defaultStore = selectDefaultActiveStore(stores);
      if (!defaultStore) {
        throw new ServiceUnavailableException(
          "Set one active default Pathao pickup store in the Merchant Panel.",
          { errorCode: "PATHAO_DEFAULT_STORE_UNAVAILABLE" },
        );
      }
      storeId = defaultStore.storeId;
    }
    const order = await this.orders.beginPathaoBookingClaim(
      orderId,
      commandId,
      fingerprint,
      "reconciliation_required",
    );
    const parcelQuantity = current?.parcelQuantity ?? order.itemQuantity;
    const parcelWeightKg =
      current?.parcelWeightKg ?? PATHAO_MINIMUM_ITEM_WEIGHT_KG;
    let info: Awaited<ReturnType<PathaoApiClient["getOrderInfo"]>>;
    try {
      info = await this.api.getOrderInfo(
        config,
        accessToken,
        input.consignmentId,
      );
    } catch (error) {
      if (error instanceof PathaoRequestError) {
        throw new ServiceUnavailableException(
          "Pathao could not verify the consignment. The Order remains blocked until it can be checked.",
          { errorCode: error.code },
        );
      }
      throw error;
    }
    if (
      info.merchantOrderId !== null &&
      info.merchantOrderId !== order.reference
    ) {
      throw new ConflictException(
        "Pathao confirms a different merchant Order reference for this consignment.",
        { errorCode: "PATHAO_RECONCILIATION_REFERENCE_MISMATCH" },
      );
    }

    try {
      const result = await this.database.db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(pathaoBooking)
          .where(
            and(
              eq(pathaoBooking.orderId, orderId),
              ne(pathaoBooking.status, "cancelled"),
            ),
          )
          .for("update")
          .limit(1);
        if (
          existing?.reconciliationCommandId === commandId &&
          existing.reconciliationFingerprint === fingerprint
        ) {
          return toBooking(existing);
        }
        if (
          existing?.reconciliationCommandId === commandId &&
          existing.reconciliationFingerprint !== fingerprint
        ) {
          throw new ConflictException(
            "The reconciliation command was already used with different details.",
            { errorCode: "PATHAO_RECONCILIATION_IDEMPOTENCY_CONFLICT" },
          );
        }
        if (existing?.status === "booked") {
          if (existing.consignmentId === input.consignmentId) {
            return toBooking(existing);
          }
          throw new ConflictException(
            "A different Pathao consignment is already associated with this Order.",
            { errorCode: "PATHAO_RECONCILIATION_ALREADY_BOOKED" },
          );
        }
        if (
          existing &&
          ![
            "outcome_unknown",
            "reconciliation_required",
            "submitting",
          ].includes(existing.status)
        ) {
          throw new ConflictException(
            "This Pathao booking is not eligible for reconciliation.",
            { errorCode: "PATHAO_RECONCILIATION_NOT_ELIGIBLE" },
          );
        }
        if (existing?.status === "submitting") {
          const [staleSubmission] = await transaction
            .select({
              stale: sql<boolean>`${pathaoBooking.submittedAt} <= clock_timestamp() - interval '15 seconds'`,
            })
            .from(pathaoBooking)
            .where(eq(pathaoBooking.id, existing.id))
            .limit(1);
          if (!staleSubmission?.stale) {
            throw new ConflictException(
              "The Pathao booking request may still be in progress. Refresh after its request timeout before reconciling.",
              { errorCode: "PATHAO_RECONCILIATION_TOO_EARLY" },
            );
          }
        }
        let booking: typeof pathaoBooking.$inferSelect;
        if (existing) {
          const [updated] = await transaction
            .update(pathaoBooking)
            .set({
              status: "booked",
              consignmentId: input.consignmentId,
              providerOrderStatus: info.orderStatus,
              lastErrorCode: null,
              reconciliationCommandId: commandId,
              reconciliationFingerprint: fingerprint,
              reconciliationReason: input.reason,
              reconciledBy: staffId,
              reconciledAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(pathaoBooking.id, existing.id))
            .returning();
          if (!updated)
            throw new Error(
              "Pathao booking disappeared during reconciliation.",
            );
          booking = updated;
        } else {
          const [inserted] = await transaction
            .insert(pathaoBooking)
            .values({
              orderId,
              source: "manual",
              environment: config.mode,
              storeId,
              deliveryType: null,
              parcelQuantity,
              parcelWeightKg,
              merchantOrderId: order.reference,
              commandId,
              requestFingerprint: fingerprint,
              reconciliationCommandId: commandId,
              reconciliationFingerprint: fingerprint,
              reconciliationReason: input.reason,
              reconciledBy: staffId,
              reconciledAt: sql`clock_timestamp()`,
              status: "booked",
              consignmentId: input.consignmentId,
              providerOrderStatus: info.orderStatus,
              createdBy: staffId,
            })
            .returning();
          if (!inserted)
            throw new Error("Manual Pathao mapping was not persisted.");
          booking = inserted;
        }

        await this.attachUnmatchedWebhooks(
          transaction,
          booking.id,
          config.mode,
          input.consignmentId,
        );
        await this.appendAudit(transaction, {
          actorId: staffId,
          eventType: "commerce.pathao_booking_manually_reconciled",
          orderId,
          reason: input.reason,
          metadata: {
            bookingId: booking.id,
            commandId,
            consignmentId: input.consignmentId,
            storeId: booking.storeId,
            providerReferenceMatched: info.merchantOrderId === order.reference,
            referenceVerifiedInPathaoPanel: input.verifiedInPathaoPanel,
          },
        });
        return toBooking(booking);
      });
      await this.orders.setPathaoBookingClaim({
        orderId,
        commandId,
        requestFingerprint: fingerprint,
        status: "booked",
        lastErrorCode: null,
      });
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findBooking(orderId);
        if (existing?.consignmentId === input.consignmentId) {
          await this.ensureBookingClaim(existing);
          return toBooking(existing);
        }
        throw new ConflictException(
          "This Pathao consignment or reconciliation command is already associated with another Order.",
          { errorCode: "PATHAO_RECONCILIATION_CONFLICT" },
        );
      }
      throw error;
    }
  }

  async getCustomerTracking(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<PathaoCustomerTracking> {
    await this.orders.authorizePathaoTrackingRead(
      orderId,
      customerId,
      signedCookies,
    );
    return this.loadCustomerTracking(orderId);
  }

  async lookupCustomerTracking(
    reference: string,
    phone: string,
  ): Promise<PathaoCustomerTrackingLookup> {
    const orderId = await this.orders.getOrderIdForCustomerTracking(
      reference,
      phone,
    );
    const booking = await this.findBooking(orderId);
    if (!booking || booking.status !== "booked" || !booking.consignmentId) {
      return PathaoCustomerTrackingLookupSchema.parse({
        trackingProgress: null,
        consignmentId: null,
        timeline: [],
      });
    }

    const observations = await this.database.db
      .select({
        eventName: pathaoWebhookInbox.eventName,
        receivedAt: pathaoWebhookInbox.receivedAt,
      })
      .from(pathaoWebhookInbox)
      .where(
        and(
          eq(pathaoWebhookInbox.bookingId, booking.id),
          eq(pathaoWebhookInbox.processingState, "verified"),
        ),
      )
      .orderBy(desc(pathaoWebhookInbox.receivedAt), desc(pathaoWebhookInbox.id))
      .limit(99);

    const timeline: PathaoCustomerTrackingLookup["timeline"] = [
      {
        trackingProgress: "booked",
        updatedAt: booking.createdAt.toISOString(),
      },
    ];
    for (const observation of observations.reverse()) {
      const progress = progressFromEvent(observation.eventName);
      if (!progress) continue;
      const event = {
        trackingProgress: progress,
        updatedAt: observation.receivedAt.toISOString(),
      };
      if (timeline.at(-1)?.trackingProgress === progress) {
        timeline[timeline.length - 1] = event;
      } else {
        timeline.push(event);
      }
    }

    return PathaoCustomerTrackingLookupSchema.parse({
      trackingProgress: booking.trackingProgress,
      consignmentId: booking.consignmentId,
      timeline,
    });
  }

  private async loadCustomerTracking(
    orderId: string,
  ): Promise<PathaoCustomerTracking> {
    const booking = await this.findBooking(orderId);
    if (!booking || booking.status !== "booked" || !booking.consignmentId) {
      return PathaoCustomerTrackingSchema.parse({
        booking: null,
        observations: [],
      });
    }
    const observations = await this.database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(
        and(
          eq(pathaoWebhookInbox.bookingId, booking.id),
          eq(pathaoWebhookInbox.processingState, "verified"),
        ),
      )
      .orderBy(desc(pathaoWebhookInbox.receivedAt), desc(pathaoWebhookInbox.id))
      .limit(100);
    return PathaoCustomerTrackingSchema.parse({
      booking: {
        consignmentId: booking.consignmentId,
        trackingProgress: booking.trackingProgress,
        createdAt: booking.createdAt.toISOString(),
      },
      observations: observations.map((observation) => ({
        event: observation.eventName,
        providerTimestamp: observation.providerTimestamp?.toISOString() ?? null,
        receivedAt: observation.receivedAt.toISOString(),
      })),
    });
  }

  async expireInterruptedBookings(): Promise<number> {
    const expired = await this.database.db.transaction(async (transaction) => {
      const stale = await transaction
        .select()
        .from(pathaoBooking)
        .where(
          sql`${pathaoBooking.status} = 'submitting' and ${pathaoBooking.submittedAt} <= clock_timestamp() - interval '15 seconds'`,
        )
        .orderBy(asc(pathaoBooking.submittedAt), asc(pathaoBooking.id))
        .for("update", { skipLocked: true })
        .limit(50);
      const updatedRows: Array<{
        orderId: string;
        commandId: string;
        requestFingerprint: string;
      }> = [];
      for (const booking of stale) {
        const [updated] = await transaction
          .update(pathaoBooking)
          .set({
            status: "outcome_unknown",
            lastErrorCode: "PATHAO_BOOKING_PROCESS_INTERRUPTED",
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(pathaoBooking.id, booking.id),
              eq(pathaoBooking.status, "submitting"),
            ),
          )
          .returning({
            id: pathaoBooking.id,
            orderId: pathaoBooking.orderId,
            commandId: pathaoBooking.commandId,
            requestFingerprint: pathaoBooking.requestFingerprint,
          });
        if (!updated) continue;
        updatedRows.push(updated);
        await this.audit.append(transaction, {
          actorType: "service",
          eventType: "commerce.pathao_booking_interrupted",
          subjectType: "order",
          subjectId: booking.orderId,
          reason:
            "The process ended before Pathao returned a durable booking result; a duplicate request was not sent.",
          metadata: {
            bookingId: booking.id,
            commandId: booking.commandId,
            environment: booking.environment,
          },
        });
      }
      return updatedRows;
    });
    await this.synchronizeBookingClaims();
    return expired.length;
  }

  private async synchronizeBookingClaims(): Promise<void> {
    const rows = await this.database.db.select().from(pathaoBooking);
    const updates = rows.flatMap((row) => {
      if (!isBookingClaimStatus(row.status)) return [];
      const usesReconciliation = row.reconciliationCommandId !== null;
      const commandId = usesReconciliation
        ? row.reconciliationCommandId
        : row.commandId;
      const requestFingerprint = usesReconciliation
        ? row.reconciliationFingerprint
        : row.requestFingerprint;
      if (!commandId || !requestFingerprint) return [];
      return [
        {
          orderId: row.orderId,
          commandId,
          requestFingerprint,
          status: row.status,
          lastErrorCode: row.lastErrorCode,
        },
      ];
    });
    await Promise.all(
      updates.map((update) => this.orders.setPathaoBookingClaim(update)),
    );
    await this.orders.recoverPathaoBookingClaims(
      rows.map((row) => row.orderId),
    );
  }

  async acceptWebhook(body: unknown): Promise<{
    handshake: boolean;
    duplicate: boolean;
  }> {
    const parsed = PathaoWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException(
        "Pathao webhook payload is invalid.",
        {
          errorCode: "PATHAO_WEBHOOK_INVALID",
        },
      );
    }
    const event = parsed.data;
    if (event.event === "webhook_integration") {
      return { handshake: true, duplicate: false };
    }
    if (event.event === "store.created" || event.event === "store.updated") {
      return { handshake: false, duplicate: false };
    }
    const config = requiredPathaoConfiguration();
    const providerTimestamp = parseProviderTimestamp(
      event.timestamp ?? event.updated_at,
    );
    const normalizedPayload = {
      event: event.event,
      ...(event.consignment_id ? { consignmentId: event.consignment_id } : {}),
      ...(event.merchant_order_id
        ? { merchantOrderId: event.merchant_order_id }
        : {}),
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      ...(event.updated_at ? { updatedAt: event.updated_at } : {}),
      ...(event.order_status ? { orderStatus: event.order_status } : {}),
      ...(event.store_id !== undefined ? { storeId: event.store_id } : {}),
      ...(event.delivery_fee !== undefined
        ? { deliveryFee: event.delivery_fee }
        : {}),
      ...(event.collected_amount !== undefined
        ? { collectedAmount: event.collected_amount }
        : {}),
    };
    const fingerprint = sha256(JSON.stringify(normalizedPayload));
    const [booking] = event.consignment_id
      ? await this.database.db
          .select({ id: pathaoBooking.id })
          .from(pathaoBooking)
          .where(
            and(
              eq(pathaoBooking.environment, config.mode),
              eq(pathaoBooking.consignmentId, event.consignment_id),
            ),
          )
          .limit(1)
      : [];
    const recognized = PATHAO_ORDER_EVENTS.has(event.event);
    const processingState = !booking
      ? "unmatched"
      : recognized
        ? "pending"
        : "reconciliation_required";
    const inserted = await this.database.db
      .insert(pathaoWebhookInbox)
      .values({
        environment: config.mode,
        eventName: event.event,
        consignmentId: event.consignment_id ?? null,
        merchantOrderId: event.merchant_order_id ?? null,
        storeId: event.store_id ?? null,
        bookingId: booking?.id ?? null,
        eventFingerprint: fingerprint,
        normalizedPayload,
        providerTimestamp,
        processingState,
      })
      .onConflictDoNothing({
        target: [
          pathaoWebhookInbox.environment,
          pathaoWebhookInbox.eventFingerprint,
        ],
      })
      .returning({ id: pathaoWebhookInbox.id });
    if (inserted.length === 0) return { handshake: false, duplicate: true };
    return { handshake: false, duplicate: false };
  }

  async processPendingWebhooks(): Promise<number> {
    const config = readPathaoConfiguration();
    if (!config) return 0;
    const leaseOwner = randomUUID();
    const claimed = await this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(pathaoWebhookInbox)
        .where(
          sql`(
          (${pathaoWebhookInbox.processingState} in ('pending', 'retry') and ${pathaoWebhookInbox.nextAttemptAt} <= clock_timestamp())
          or (${pathaoWebhookInbox.processingState} = 'processing' and ${pathaoWebhookInbox.processingLeaseExpiresAt} <= clock_timestamp())
        )`,
        )
        .orderBy(
          asc(pathaoWebhookInbox.nextAttemptAt),
          asc(pathaoWebhookInbox.id),
        )
        .for("update", { skipLocked: true })
        .limit(10);
      if (rows.length === 0) return [];
      return transaction
        .update(pathaoWebhookInbox)
        .set({
          processingState: "processing",
          processingLeaseExpiresAt: sql`clock_timestamp() + interval '20 seconds'`,
          processingLeaseOwner: leaseOwner,
          attemptCount: sql`${pathaoWebhookInbox.attemptCount} + 1`,
        })
        .where(
          inArray(
            pathaoWebhookInbox.id,
            rows.map((row) => row.id),
          ),
        )
        .returning();
    });

    await Promise.all(
      claimed.map(async (event) => {
        try {
          await this.verifyWebhookObservation(config, event, leaseOwner);
        } catch (error) {
          await this.retryWebhook(event, leaseOwner, error);
        }
      }),
    );
    return claimed.length;
  }

  verifyWebhookSignature(signature: string | undefined): boolean {
    let config: PathaoConfiguration;
    try {
      config = requiredPathaoConfiguration();
    } catch {
      return false;
    }
    if (!signature || signature.length > 512) return false;
    const configured = createHash("sha256")
      .update(config.webhookSecret, "utf8")
      .digest();
    const presented = createHash("sha256").update(signature, "utf8").digest();
    return timingSafeEqual(configured, presented);
  }

  private async verifyWebhookObservation(
    config: PathaoConfiguration,
    event: InboxRow,
    leaseOwner: string,
  ): Promise<void> {
    if (!event.bookingId || !event.consignmentId) {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "unmatched",
        null,
        "PATHAO_MAPPING_MISSING",
      );
      return;
    }
    const [booking] = await this.database.db
      .select()
      .from(pathaoBooking)
      .where(eq(pathaoBooking.id, event.bookingId))
      .limit(1);
    if (
      !booking ||
      booking.environment !== config.mode ||
      (booking.status !== "booked" && booking.status !== "cancelled") ||
      booking.consignmentId !== event.consignmentId
    ) {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "reconciliation_required",
        null,
        "PATHAO_CONSIGNMENT_MAPPING_MISMATCH",
      );
      return;
    }
    const { accessToken } = await this.tokens.getAccessToken();
    const info = await this.api.getOrderInfo(
      config,
      accessToken,
      booking.consignmentId,
    );
    const payload = event.normalizedPayload as {
      merchantOrderId?: string;
      orderStatus?: string;
      storeId?: number;
      event: string;
      collectedAmount?: number;
      deliveryFee?: number;
    };
    if (
      info.consignmentId !== booking.consignmentId ||
      (info.merchantOrderId !== null &&
        info.merchantOrderId !== booking.merchantOrderId) ||
      (payload.merchantOrderId !== undefined &&
        payload.merchantOrderId !== booking.merchantOrderId) ||
      (payload.storeId !== undefined && payload.storeId !== booking.storeId)
    ) {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "reconciliation_required",
        info.orderStatus,
        "PATHAO_ORDER_IDENTITY_MISMATCH",
      );
      return;
    }

    const eventProgress = progressFromEvent(payload.event);
    const providerProgress = progressFromStatus(info.orderStatus);
    if (eventProgress !== null && providerProgress === null) {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "reconciliation_required",
        info.orderStatus,
        "PATHAO_STATUS_REQUIRES_REVIEW",
      );
      return;
    }
    if (eventProgress === "cancelled" && providerProgress !== "cancelled") {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "reconciliation_required",
        info.orderStatus,
        "PATHAO_PICKUP_CANCELLATION_UNCONFIRMED",
      );
      return;
    }

    await this.database.db.transaction(async (transaction) => {
      const [lockedEvent] = await transaction
        .select()
        .from(pathaoWebhookInbox)
        .where(eq(pathaoWebhookInbox.id, event.id))
        .for("update")
        .limit(1);
      if (
        !lockedEvent ||
        lockedEvent.processingState !== "processing" ||
        lockedEvent.processingLeaseOwner !== leaseOwner
      ) {
        return;
      }
      const [lockedBooking] = await transaction
        .select()
        .from(pathaoBooking)
        .where(eq(pathaoBooking.id, booking.id))
        .for("update")
        .limit(1);
      if (!lockedBooking) return;
      if (
        lockedBooking.status === "cancelled" &&
        providerProgress !== "cancelled"
      ) {
        await transaction
          .update(pathaoWebhookInbox)
          .set({
            processingState: "reconciliation_required",
            providerOrderStatus: info.orderStatus,
            lastErrorCode: "PATHAO_STATUS_CHANGED_AFTER_CANCELLATION",
            processedAt: sql`clock_timestamp()`,
            processingLeaseExpiresAt: null,
            processingLeaseOwner: null,
          })
          .where(eq(pathaoWebhookInbox.id, event.id));
        return;
      }
      if (
        providerProgress === "cancelled" &&
        lockedBooking.status !== "cancelled"
      ) {
        const result = await this.cancelBookingWithinTransaction(
          transaction,
          lockedBooking,
          info.orderStatus,
          "webhook",
        );
        if (result.blockedReason) {
          await transaction
            .update(pathaoWebhookInbox)
            .set({
              processingState: "reconciliation_required",
              providerOrderStatus: info.orderStatus,
              lastErrorCode:
                result.blockedReason === "after_pickup"
                  ? "PATHAO_CANCELLATION_AFTER_PICKUP_BLOCKED"
                  : "PATHAO_CANCELLATION_AFTER_DISPATCH_BLOCKED",
              processedAt: sql`clock_timestamp()`,
              processingLeaseExpiresAt: null,
              processingLeaseOwner: null,
            })
            .where(eq(pathaoWebhookInbox.id, event.id));
          return;
        }
      }
      if (
        providerProgress !== "cancelled" ||
        lockedBooking.status === "cancelled"
      ) {
        await transaction
          .update(pathaoBooking)
          .set({
            status:
              lockedBooking.status === "cancelled" ? "cancelled" : "booked",
            trackingProgress:
              lockedBooking.status === "cancelled"
                ? "cancelled"
                : (providerProgress ??
                  (lockedBooking.trackingProgress as Progress)),
            providerOrderStatus: info.orderStatus,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(pathaoBooking.id, booking.id));
      }
      await transaction
        .update(pathaoWebhookInbox)
        .set({
          processingState: "verified",
          providerOrderStatus: info.orderStatus,
          providerCollectedAmountBdt:
            typeof payload.collectedAmount === "number"
              ? payload.collectedAmount
              : null,
          lastErrorCode: null,
          processedAt: sql`clock_timestamp()`,
          processingLeaseExpiresAt: null,
          processingLeaseOwner: null,
        })
        .where(
          and(
            eq(pathaoWebhookInbox.id, event.id),
            eq(pathaoWebhookInbox.processingLeaseOwner, leaseOwner),
          ),
        );
    });
  }

  private async retryWebhook(
    event: InboxRow,
    leaseOwner: string,
    error: unknown,
  ): Promise<void> {
    const code =
      error instanceof PathaoRequestError
        ? error.code
        : "PATHAO_VERIFICATION_UNAVAILABLE";
    await this.database.db
      .update(pathaoWebhookInbox)
      .set({
        processingState: "retry",
        processingLeaseExpiresAt: null,
        processingLeaseOwner: null,
        lastErrorCode: code,
        nextAttemptAt: sql`clock_timestamp() + least(interval '1 hour', interval '1 minute' * power(2, greatest(0, ${event.attemptCount} - 1)))`,
      })
      .where(
        and(
          eq(pathaoWebhookInbox.id, event.id),
          eq(pathaoWebhookInbox.processingState, "processing"),
          eq(pathaoWebhookInbox.processingLeaseOwner, leaseOwner),
        ),
      );
  }

  private async finishWebhook(
    id: string,
    leaseOwner: string,
    state: "verified" | "reconciliation_required" | "unmatched",
    providerStatus: string | null,
    errorCode: string | null,
  ): Promise<void> {
    await this.database.db
      .update(pathaoWebhookInbox)
      .set({
        processingState: state,
        providerOrderStatus: providerStatus,
        lastErrorCode: errorCode,
        processedAt: sql`clock_timestamp()`,
        processingLeaseExpiresAt: null,
        processingLeaseOwner: null,
      })
      .where(
        and(
          eq(pathaoWebhookInbox.id, id),
          eq(pathaoWebhookInbox.processingState, "processing"),
          eq(pathaoWebhookInbox.processingLeaseOwner, leaseOwner),
        ),
      );
  }

  private async markUnknown(
    bookingId: string,
    staffId: string,
    error: unknown,
  ): Promise<void> {
    const safeCode =
      error instanceof PathaoRequestError
        ? error.code
        : "PATHAO_BOOKING_OUTCOME_UNKNOWN";
    const row = await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .update(pathaoBooking)
        .set({
          status: "outcome_unknown",
          lastErrorCode: safeCode,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(pathaoBooking.id, bookingId),
            eq(pathaoBooking.status, "submitting"),
          ),
        )
        .returning();
      if (!row) return null;
      await this.appendAudit(transaction, {
        actorId: staffId,
        eventType: "commerce.pathao_booking_outcome_unknown",
        orderId: row.orderId,
        reason:
          "Pathao booking response was not definitive; no retry was sent.",
        metadata: { bookingId, commandId: row.commandId, errorCode: safeCode },
      });
      return row;
    });
    if (row) {
      await this.orders.setPathaoBookingClaim({
        orderId: row.orderId,
        commandId: row.commandId,
        requestFingerprint: row.requestFingerprint,
        status: "outcome_unknown",
        lastErrorCode: safeCode,
      });
    }
  }

  private async findBooking(orderId: string) {
    const [row] = await this.database.db
      .select()
      .from(pathaoBooking)
      .where(eq(pathaoBooking.orderId, orderId))
      .orderBy(desc(pathaoBooking.createdAt), desc(pathaoBooking.id))
      .limit(1);
    return row ?? null;
  }

  private async cancelBookingWithinTransaction(
    transaction: AuditTransaction,
    booking: typeof pathaoBooking.$inferSelect,
    providerOrderStatus: string | null,
    source: "status_sync" | "webhook",
  ): Promise<PathaoCancellationResult> {
    if (booking.trackingProgress !== "booked") {
      return { booking: null, blockedReason: "after_pickup" };
    }
    const released =
      await this.orders.releasePathaoBookingClaimWithinTransaction(
        transaction,
        booking.orderId,
      );
    if (!released) {
      return { booking: null, blockedReason: "after_dispatch" };
    }

    const [cancelled] = await transaction
      .update(pathaoBooking)
      .set({
        status: "cancelled",
        trackingProgress: "cancelled",
        providerOrderStatus,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(pathaoBooking.id, booking.id))
      .returning();
    if (!cancelled) {
      throw new Error("Pathao booking disappeared during cancellation.");
    }

    await this.audit.append(transaction, {
      actorType: "service",
      eventType: "commerce.pathao_booking_cancelled",
      subjectType: "order",
      subjectId: booking.orderId,
      occurredAt: cancelled.updatedAt,
      reason: "Pathao confirmed cancellation before pickup.",
      metadata: {
        bookingId: booking.id,
        consignmentId: booking.consignmentId,
        source,
      },
    });
    return { booking: cancelled, blockedReason: null };
  }

  private async getBookingById(id: string): Promise<PathaoBooking> {
    const [row] = await this.database.db
      .select()
      .from(pathaoBooking)
      .where(eq(pathaoBooking.id, id))
      .limit(1);
    if (!row) throw new Error("Pathao booking record disappeared.");
    return toBooking(row);
  }

  private assertReplay(
    existing: typeof pathaoBooking.$inferSelect,
    commandId: string,
  ): PathaoBooking {
    if (existing.commandId !== commandId) {
      throw new ConflictException(
        "This Order already has a Pathao booking command. Resolve its outcome before creating another consignment.",
        { errorCode: "PATHAO_BOOKING_ALREADY_EXISTS" },
      );
    }
    return toBooking(existing);
  }

  private async appendAudit(
    transaction: AuditTransaction,
    event: {
      actorId: string;
      eventType: string;
      orderId: string;
      reason: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      actorType: "user",
      actorId: event.actorId,
      eventType: event.eventType,
      subjectType: "order",
      subjectId: event.orderId,
      reason: event.reason,
      metadata: event.metadata,
    });
  }

  private async attachUnmatchedWebhooks(
    transaction: AuditTransaction,
    bookingId: string,
    environment: string,
    consignmentId: string,
  ): Promise<void> {
    await transaction
      .update(pathaoWebhookInbox)
      .set({
        bookingId,
        processingState: "pending",
        nextAttemptAt: sql`clock_timestamp()`,
        lastErrorCode: null,
        processedAt: null,
      })
      .where(
        and(
          eq(pathaoWebhookInbox.environment, environment),
          eq(pathaoWebhookInbox.consignmentId, consignmentId),
          isNull(pathaoWebhookInbox.bookingId),
          eq(pathaoWebhookInbox.processingState, "unmatched"),
          inArray(pathaoWebhookInbox.eventName, [...PATHAO_ORDER_EVENTS]),
        ),
      );
  }

  private async ensureBookingClaim(
    booking: typeof pathaoBooking.$inferSelect,
  ): Promise<void> {
    if (!isBookingClaimStatus(booking.status)) return;
    const usesReconciliation = booking.reconciliationCommandId !== null;
    const commandId = usesReconciliation
      ? booking.reconciliationCommandId
      : booking.commandId;
    const requestFingerprint = usesReconciliation
      ? booking.reconciliationFingerprint
      : booking.requestFingerprint;
    if (!commandId || !requestFingerprint) return;
    await this.orders.setPathaoBookingClaim({
      orderId: booking.orderId,
      commandId,
      requestFingerprint,
      status: booking.status,
      lastErrorCode: booking.lastErrorCode,
    });
  }

  private assertWebhookResolutionReplay(
    existing: typeof pathaoWebhookResolution.$inferSelect,
    eventId: string,
    fingerprint: string,
  ): PathaoWebhookResolutionResult {
    if (
      existing.eventId !== eventId ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException(
        "The webhook resolution command was already used with different details.",
        { errorCode: "PATHAO_WEBHOOK_RESOLUTION_IDEMPOTENCY_CONFLICT" },
      );
    }
    return PathaoWebhookResolutionResultSchema.parse({
      eventId: existing.eventId,
      action: existing.action,
      status: existing.resultingState,
    });
  }
}

export function isPathaoWebhookPayload(value: unknown): boolean {
  return PathaoWebhookBodySchema.safeParse(value).success;
}

function requiredPathaoConfiguration(): PathaoConfiguration {
  const config = readPathaoConfiguration();
  if (!config) {
    throw new ServiceUnavailableException(
      "Pathao integration is not configured.",
      {
        errorCode: "PATHAO_NOT_CONFIGURED",
      },
    );
  }
  return config;
}

function selectDefaultActiveStore(
  stores: readonly PathaoStoreRecord[],
): PathaoStoreRecord | null {
  const activeStores = stores.filter((store) => store.active);
  const defaults = activeStores.filter((store) => store.isDefaultStore);
  if (defaults.length === 1) return defaults[0] ?? null;
  if (defaults.length > 1) return null;
  return activeStores.length === 1 ? (activeStores[0] ?? null) : null;
}

function bookingFingerprint(input: {
  orderId: string;
  storeId: number;
  deliveryType: PathaoDeliveryType;
  parcelQuantity: number;
  parcelWeightKg: number;
}): string {
  return sha256(
    JSON.stringify({
      orderId: input.orderId,
      input: {
        storeId: input.storeId,
        deliveryType: input.deliveryType,
        parcelQuantity: input.parcelQuantity,
        parcelWeightKg: input.parcelWeightKg,
      },
    }),
  );
}

export function toProviderRequest(
  order: Awaited<ReturnType<OrdersPathaoPort["getPathaoBookingSnapshot"]>>,
  storeId: number,
): PathaoBookingRequest {
  const recipientPhone = pathaoPhone(order.recipientPhone);
  const specialInstruction = sanitizeCustomerInstruction(
    order.customerInstructions,
  );
  if (
    order.recipientName.trim().length < 3 ||
    order.recipientName.trim().length > 100 ||
    order.recipientAddress.trim().length < 10 ||
    order.recipientAddress.trim().length > 220
  ) {
    throw new UnprocessableEntityException(
      "The Order recipient details do not meet Pathao's documented limits.",
      { errorCode: "PATHAO_RECIPIENT_DETAILS_INVALID" },
    );
  }
  return {
    store_id: storeId,
    merchant_order_id: order.reference,
    recipient_name: order.recipientName.trim(),
    recipient_phone: recipientPhone,
    recipient_address: order.recipientAddress.trim(),
    ...(specialInstruction ? { special_instruction: specialInstruction } : {}),
    delivery_type: PATHAO_NORMAL_DELIVERY_TYPE,
    item_type: PATHAO_PARCEL_ITEM_TYPE,
    item_quantity: order.itemQuantity,
    item_weight: PATHAO_MINIMUM_ITEM_WEIGHT_KG,
    amount_to_collect: order.codAmountDueBdt,
  };
}

function sanitizeCustomerInstruction(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || null;
}

function pathaoPhone(value: string): string {
  const match = /^\+880(1[3-9]\d{8})$/.exec(value);
  if (!match) {
    throw new UnprocessableEntityException(
      "The Order phone number cannot be represented as a Bangladesh Pathao number.",
      { errorCode: "PATHAO_PHONE_INVALID" },
    );
  }
  return `0${match[1]}`;
}

function toBooking(row: typeof pathaoBooking.$inferSelect): PathaoBooking {
  return PathaoBookingSchema.parse({
    orderId: row.orderId,
    environment: row.environment,
    source: row.source,
    storeId: row.storeId,
    deliveryType: row.deliveryType,
    parcelQuantity: row.parcelQuantity,
    parcelWeightKg: row.parcelWeightKg,
    merchantOrderId: row.merchantOrderId,
    status: row.status,
    consignmentId: row.consignmentId,
    providerOrderStatus: row.providerOrderStatus,
    deliveryFeeBdt: row.deliveryFeeBdt,
    lastErrorCode: row.lastErrorCode,
    reconciliationReason: row.reconciliationReason,
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
    trackingProgress: row.trackingProgress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toObservation(row: InboxRow): PathaoWebhookObservation {
  return {
    event: row.eventName,
    consignmentId: row.consignmentId,
    status: row.processingState as PathaoWebhookObservation["status"],
    providerStatus: row.providerOrderStatus,
    providerCollectedAmount: row.providerCollectedAmountBdt,
    providerTimestamp: row.providerTimestamp?.toISOString() ?? null,
    receivedAt: row.receivedAt.toISOString(),
    errorCode: row.lastErrorCode,
  };
}

function parseProviderTimestamp(value: string | undefined): Date | null {
  if (!value || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function isBookingClaimStatus(
  status: string,
): status is PathaoBookingClaimStatus {
  return [
    "submitting",
    "booked",
    "outcome_unknown",
    "reconciliation_required",
  ].includes(status);
}

function normalizeStatus(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function progressFromEvent(event: string): Progress | null {
  switch (event) {
    case "order.created":
    case "order.pickup-requested":
    case "order.assigned-for-pickup":
      return "booked";
    case "order.picked":
      return "pickup";
    case "order.at-the-sorting-hub":
    case "order.in-transit":
    case "order.received-at-last-mile-hub":
      return "in_transit";
    case "order.assigned-for-delivery":
      return "out_for_delivery";
    case "order.delivered":
      return "delivered";
    case "order.partial-delivery":
      return "partial_delivery";
    case "order.delivery-failed":
      return "delivery_failed";
    case "order.pickup-failed":
    case "order.on-hold":
      return "on_hold";
    case "order.pickup-cancelled":
      return "cancelled";
    case "order.returned":
    case "order.return-id-created":
    case "order.return-in-transit":
      return "returning";
    case "order.returned-to-merchant":
      return "returned";
    case "order.updated":
    case "order.paid-return":
    case "order.exchanged":
    case "order.paid":
      return null;
    default:
      return null;
  }
}

export function progressFromStatus(status: string | null): Progress | null {
  if (!status) return null;
  const normalizedStatus = normalizeStatus(status);
  const statusName = normalizedStatus.startsWith("order")
    ? normalizedStatus.slice("order".length)
    : normalizedStatus;
  const event = PATHAO_STATUS_EVENTS[statusName];
  return event ? progressFromEvent(event) : null;
}

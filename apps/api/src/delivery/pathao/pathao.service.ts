import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  PathaoBookingInputSchema,
  PathaoBookingManagementSchema,
  PathaoBookingOptionsSchema,
  PathaoBookingSchema,
  PathaoCustomerTrackingSchema,
  PathaoManagementBookingSummariesSchema,
  PathaoManagementIssuesSchema,
  MAX_LIST_OFFSET,
  PathaoManualReconciliationInputSchema,
  PathaoWebhookResolutionInputSchema,
  PathaoWebhookResolutionResultSchema,
  PathaoStoreListSchema,
  type PathaoBooking,
  type PathaoBookingInput,
  type PathaoBookingManagement,
  type PathaoBookingOptions,
  type PathaoCustomerTracking,
  type PathaoDeliveryType,
  type PathaoManagementIssues,
  type PathaoManagementIssuesQuery,
  type PathaoManualReconciliationInput,
  type PathaoWebhookResolutionInput,
  type PathaoWebhookResolutionResult,
  type PathaoWebhookObservation,
} from "@aaraj/contracts";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
} from "./pathao-api.client.js";
import {
  readPathaoConfiguration,
  type PathaoConfiguration,
} from "./pathao-config.js";
import { PathaoTokenService } from "./pathao-token.service.js";

const PATHAO_WEBHOOK_INTEGRATION_SECRET =
  "f3992ecc-59da-4cbe-a049-a13da2018d51";
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

  async listActiveStores(): Promise<PathaoBookingOptions> {
    const { config, accessToken } = await this.tokens.getAccessToken();
    const records = await this.api.listStores(config, accessToken);
    const activeStores = records.filter((store) => store.active);
    return PathaoBookingOptionsSchema.parse({
      deliveryType: config.deliveryType,
      stores: PathaoStoreListSchema.parse(
        activeStores.map((store) => ({
          storeId: store.storeId,
          storeName: store.storeName,
          active: store.active,
        })),
      ),
    });
  }

  async createBooking(
    orderId: string,
    staffId: string,
    rawCommandId: string,
    rawInput: PathaoBookingInput,
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
    const input = PathaoBookingInputSchema.parse(rawInput);
    const config = requiredPathaoConfiguration();
    const fingerprint = sha256(
      JSON.stringify({
        orderId,
        input: {
          storeId: input.storeId,
          deliveryType: config.deliveryType,
          parcelQuantity: input.parcelQuantity,
          parcelWeightKg: Number(input.parcelWeightKg),
        },
      }),
    );
    const existing = await this.findBooking(orderId);
    if (existing) {
      const replay = this.assertReplay(existing, commandId, fingerprint);
      await this.ensureBookingClaim(existing);
      return replay;
    }
    const { config: authenticatedConfig, accessToken } =
      await this.tokens.getAccessToken();
    await this.assertActiveStore(
      authenticatedConfig,
      accessToken,
      input.storeId,
    );
    const order = await this.orders.beginPathaoBookingClaim(
      orderId,
      commandId,
      fingerprint,
      "submitting",
    );
    const providerRequest = toProviderRequest(
      order,
      input,
      config.deliveryType,
    );
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
            storeId: input.storeId,
            deliveryType: config.deliveryType,
            parcelQuantity: input.parcelQuantity,
            parcelWeightKg: input.parcelWeightKg,
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
            storeId: input.storeId,
            deliveryType: config.deliveryType,
            parcelQuantity: input.parcelQuantity,
            parcelWeightKg: input.parcelWeightKg,
          },
        });
        return row;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findBooking(orderId);
      if (!existing) throw error;
      return this.assertReplay(existing, commandId, fingerprint);
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

  async getManagementBookingSummaries(orderIds: readonly string[]) {
    if (orderIds.length === 0) return [];
    const [bookings, claims, unresolvedWebhookRows] = await Promise.all([
      this.database.db
        .select({
          orderId: pathaoBooking.orderId,
          status: pathaoBooking.status,
          trackingProgress: pathaoBooking.trackingProgress,
          consignmentId: pathaoBooking.consignmentId,
        })
        .from(pathaoBooking)
        .where(inArray(pathaoBooking.orderId, [...orderIds])),
      this.orders.getPathaoBookingClaimStatuses(orderIds),
      this.database.db
        .selectDistinct({ orderId: pathaoBooking.orderId })
        .from(pathaoWebhookInbox)
        .innerJoin(
          pathaoBooking,
          eq(pathaoWebhookInbox.bookingId, pathaoBooking.id),
        )
        .where(
          and(
            inArray(pathaoBooking.orderId, [...orderIds]),
            eq(pathaoWebhookInbox.processingState, "reconciliation_required"),
          ),
        ),
    ]);
    const bookingByOrderId = new Map(
      bookings.map((booking) => [booking.orderId, booking]),
    );
    const claimStatusByOrderId = new Map(
      claims.map((claim) => [claim.orderId, claim.status]),
    );
    const ordersWithUnresolvedWebhookIssue = new Set(
      unresolvedWebhookRows.map(({ orderId }) => orderId),
    );
    return PathaoManagementBookingSummariesSchema.parse(
      orderIds.map((orderId) => {
        const booking = bookingByOrderId.get(orderId);
        return {
          orderId,
          status: claimStatusByOrderId.get(orderId) ?? booking?.status ?? null,
          trackingProgress: booking?.trackingProgress ?? null,
          consignmentId: booking?.consignmentId ?? null,
          hasUnresolvedWebhookIssue:
            ordersWithUnresolvedWebhookIssue.has(orderId),
        };
      }),
    );
  }

  async getManagementDetails(
    orderId: string,
  ): Promise<PathaoBookingManagement> {
    const booking = await this.findBooking(orderId);
    const claimStatus = await this.orders.getPathaoBookingClaimStatus(orderId);
    if (!booking) return { booking: null, claimStatus, observations: [] };
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

    if (current && current.storeId !== input.storeId) {
      throw new ConflictException(
        "The consignment store must match the existing booking command.",
        { errorCode: "PATHAO_RECONCILIATION_STORE_MISMATCH" },
      );
    }
    const { accessToken } = await this.tokens.getAccessToken();
    const order = await this.orders.beginPathaoBookingClaim(
      orderId,
      commandId,
      fingerprint,
      "reconciliation_required",
    );
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
          .where(eq(pathaoBooking.orderId, orderId))
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
        if (existing && existing.storeId !== input.storeId) {
          throw new ConflictException(
            "The consignment store must match the existing booking command.",
            { errorCode: "PATHAO_RECONCILIATION_STORE_MISMATCH" },
          );
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
              storeId: input.storeId,
              deliveryType: null,
              parcelQuantity: input.parcelQuantity,
              parcelWeightKg: input.parcelWeightKg,
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
            storeId: input.storeId,
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

  webhookIntegrationResponseSecret(): string {
    return PATHAO_WEBHOOK_INTEGRATION_SECRET;
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
      booking.status !== "booked" ||
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

    const progress = progressFromEvent(payload.event);
    if (progress !== null && progress !== "booked") {
      const fulfillment = await this.orders.getPathaoFulfillmentSnapshot(
        booking.orderId,
      );
      if (fulfillment.dispatchedAt === null) {
        await this.finishWebhook(
          event.id,
          leaseOwner,
          "reconciliation_required",
          info.orderStatus,
          "PATHAO_ACTIVITY_BEFORE_AARAJ_DISPATCH",
        );
        return;
      }
    }
    const expectedStatus = payload.event.startsWith("order.")
      ? normalizeStatus(payload.event.slice("order.".length))
      : null;
    const currentStatus = info.orderStatus
      ? normalizeStatus(info.orderStatus)
      : null;
    const materialStatus = progress !== null && progress !== "booked";
    if (materialStatus && expectedStatus !== currentStatus) {
      await this.finishWebhook(
        event.id,
        leaseOwner,
        "reconciliation_required",
        info.orderStatus,
        "PATHAO_STATUS_REQUIRES_REVIEW",
      );
      return;
    }

    const finalState = await this.database.db.transaction(
      async (transaction) => {
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
          return "lease_lost" as const;
        }
        const [lockedBooking] = await transaction
          .select()
          .from(pathaoBooking)
          .where(eq(pathaoBooking.id, booking.id))
          .for("update")
          .limit(1);
        if (!lockedBooking) return "lease_lost" as const;
        const projected = mergeProgress(
          lockedBooking.trackingProgress as Progress,
          progress,
        );
        await transaction
          .update(pathaoBooking)
          .set({
            trackingProgress: projected.progress,
            providerOrderStatus: info.orderStatus,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(pathaoBooking.id, booking.id));
        const state = projected.reconciliationRequired
          ? "reconciliation_required"
          : "verified";
        await transaction
          .update(pathaoWebhookInbox)
          .set({
            processingState: state,
            providerOrderStatus: info.orderStatus,
            providerCollectedAmountBdt:
              typeof payload.collectedAmount === "number"
                ? payload.collectedAmount
                : null,
            lastErrorCode: projected.reconciliationRequired
              ? "PATHAO_CONFLICTING_TERMINAL_STATUS"
              : null,
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
        return state;
      },
    );

    if (finalState === "lease_lost") return;
    if (finalState === "reconciliation_required") {
      await this.database.db.transaction(async (transaction) => {
        await this.audit.append(transaction, {
          actorType: "service",
          eventType: "commerce.pathao_tracking_reconciliation_required",
          subjectType: "order",
          subjectId: booking.orderId,
          reason: "Pathao reported conflicting terminal tracking observations.",
          metadata: {
            bookingId: booking.id,
            webhookObservationId: event.id,
            eventName: event.eventName,
          },
        });
      });
    }
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
      .limit(1);
    return row ?? null;
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
    fingerprint: string,
  ): PathaoBooking {
    if (
      existing.commandId !== commandId ||
      existing.requestFingerprint !== fingerprint
    ) {
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

  private async assertActiveStore(
    config: PathaoConfiguration,
    accessToken: string,
    storeId: number,
  ): Promise<void> {
    const stores = await this.api.listStores(config, accessToken);
    if (!stores.some((store) => store.storeId === storeId && store.active)) {
      throw new UnprocessableEntityException(
        "Choose an active Pathao store returned for this merchant account.",
        { errorCode: "PATHAO_STORE_NOT_ACTIVE" },
      );
    }
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

function toProviderRequest(
  order: Awaited<ReturnType<OrdersPathaoPort["getPathaoBookingSnapshot"]>>,
  input: PathaoBookingInput,
  deliveryType: PathaoDeliveryType,
): PathaoBookingRequest {
  const recipientPhone = pathaoPhone(order.recipientPhone);
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
    store_id: input.storeId,
    merchant_order_id: order.reference,
    recipient_name: order.recipientName.trim(),
    recipient_phone: recipientPhone,
    recipient_address: order.recipientAddress.trim(),
    delivery_type: deliveryType,
    item_type: 2,
    item_quantity: input.parcelQuantity,
    item_weight: Number(input.parcelWeightKg),
    amount_to_collect: order.codAmountDueBdt,
  };
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
    parcelWeightKg: Number(row.parcelWeightKg),
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

function progressFromEvent(event: string): Progress | null {
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
    case "order.pickup-failed":
    case "order.pickup-cancelled":
    case "order.on-hold":
      return "on_hold";
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

function mergeProgress(
  current: Progress,
  next: Progress | null,
): { progress: Progress; reconciliationRequired: boolean } {
  if (next === null)
    return { progress: current, reconciliationRequired: false };
  if (current === "reconciliation_required") {
    return { progress: current, reconciliationRequired: true };
  }
  const currentTerminal = terminalProgress(current);
  const nextTerminal = terminalProgress(next);
  if (currentTerminal && nextTerminal && current !== next) {
    return {
      progress: "reconciliation_required",
      reconciliationRequired: true,
    };
  }
  if (progressRank(next) < progressRank(current)) {
    return { progress: current, reconciliationRequired: false };
  }
  return { progress: next, reconciliationRequired: false };
}

function terminalProgress(value: Progress): boolean {
  return ["delivered", "partial_delivery", "returned"].includes(value);
}

function progressRank(value: Progress): number {
  switch (value) {
    case "booked":
      return 0;
    case "pickup":
      return 1;
    case "in_transit":
    case "on_hold":
      return 2;
    case "out_for_delivery":
      return 3;
    case "delivered":
    case "partial_delivery":
    case "delivery_failed":
    case "returning":
      return 4;
    case "returned":
      return 5;
    case "reconciliation_required":
      return 6;
  }
}

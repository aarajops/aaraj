import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  OrderAddressSchema,
  OrderCreatedSchema,
  OrderManagementListSchema,
  OrderSchema,
  ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS,
  type CheckoutAddressInput,
  type CreateOrderInput,
  type Order,
  type OrderAddress,
  type OrderCreated,
  type OrderListQuery,
  type OrderServiceabilityInput,
} from "@aaraj/contracts";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { CartService, type CartQuoteOwner } from "../cart/cart.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { GeographyService } from "../geography/geography.service.js";
import {
  INVENTORY_RESERVATION_PORT,
  type InventoryReservationPort,
} from "../inventory/inventory-reservation.port.js";
import { QuoteService } from "../quote/quote.service.js";
import {
  customerOrder,
  customerOrderLine,
  orderIdempotency,
} from "./orders-schema.js";

const ORDER_GUEST_COOKIE_PREFIX = "aaraj_order_";
const ORDER_ATTEMPT_COOKIE_PREFIX = "aaraj_order_attempt_";
const MAX_ORDER_LINES = 50;

class ServiceabilityExpiryTransitionError extends Error {
  constructor(
    readonly orderId: string,
    options: { cause: unknown },
  ) {
    super("Order serviceability expiry transition failed.", options);
  }
}

type OrderRow = typeof customerOrder.$inferSelect;
type IdempotencyRow = typeof orderIdempotency.$inferSelect;
type NormalizedAddress = OrderAddress;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly cart: CartService,
    private readonly quotes: QuoteService,
    private readonly geography: GeographyService,
    private readonly audit: AuditService,
    @Inject(INVENTORY_RESERVATION_PORT)
    private readonly inventory: InventoryReservationPort,
  ) {}

  async create(
    customerId: string | undefined,
    guestCartId: string | undefined,
    input: CreateOrderInput,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
  ): Promise<{ order: OrderCreated; guestCredential: string | null }> {
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner) throw orderNotFound();
    const owner = context.owner;
    const normalizedInput = normalizeCheckoutInput(input.address);
    const requestFingerprint = fingerprintCheckout(
      input.quoteId,
      normalizedInput,
      getOrderPiiKey(),
    );
    const ownerHash = hashOwner(owner);
    const keyHash = sha256(idempotencyKey);

    const replay = await this.findIdempotencyReplay(
      ownerHash,
      keyHash,
      requestFingerprint,
    );
    if (replay) {
      return this.resolveReplay(replay, owner, idempotencyKey, signedCookies);
    }

    if (context.cart.lines.length === 0) {
      throw new ConflictException("The cart is empty or no longer available.", {
        errorCode: "ORDER_CART_UNAVAILABLE",
      });
    }

    const address = await this.resolveAddress(input.address);
    const quote = await this.quotes.getCurrentForCheckout(
      customerId,
      guestCartId,
      input.quoteId,
    );
    if (
      !sameDestination(quote, input.address) ||
      quote.cartRevision !== context.cart.revision ||
      quote.lines.length !== context.cart.lines.length ||
      quote.lines.some(
        (line, index) =>
          line.variantId !== context.cart.lines[index]?.variantId ||
          line.quantity !== context.cart.lines[index]?.quantity,
      )
    ) {
      throw new ConflictException(
        "The cart or delivery destination changed. Request a fresh quote.",
        { errorCode: "QUOTE_STALE" },
      );
    }
    if (quote.lines.length === 0 || quote.lines.length > MAX_ORDER_LINES) {
      throw new UnprocessableEntityException(
        "The Order line limit was exceeded.",
      );
    }

    const orderId = randomUUID();
    const reference = `AA-${randomBytes(6).toString("hex").toUpperCase()}`;
    const guestCredential =
      owner.kind === "guest"
        ? signedCookies[guestOrderAttemptCookieName(idempotencyKey)]
        : null;
    if (
      owner.kind === "guest" &&
      !isGuestAttemptCredential(guestCredential, idempotencyKey)
    ) {
      throw new ConflictException(
        "Prepare guest Order access again before submitting checkout.",
        { errorCode: "GUEST_ORDER_ACCESS_REQUIRED" },
      );
    }
    const piiKey = getOrderPiiKey();
    const encryptedAddress = encryptAddress(address, orderId, piiKey);

    let saved: OrderRow;
    let replayed = false;
    try {
      saved = await this.database.db.transaction(async (transaction) => {
        await lockOrderIdempotency(transaction, ownerHash, keyHash);
        const [prior] = await transaction
          .select()
          .from(orderIdempotency)
          .where(
            and(
              eq(orderIdempotency.ownerHash, ownerHash),
              eq(orderIdempotency.keyHash, keyHash),
            ),
          )
          .limit(1);
        if (prior) {
          assertIdempotencyFingerprint(prior, requestFingerprint);
          const row = await loadOrderRow(transaction, prior.orderId);
          if (!row) throw new Error("Idempotency record has no Order.");
          replayed = true;
          return row;
        }

        const reservation = await this.inventory.reserveWithinTransaction(
          transaction,
          {
            commandId: orderId,
            lines: quote.lines.map(({ variantId, quantity }) => ({
              variantId,
              quantity,
            })),
          },
        );
        const [row] = await transaction
          .insert(customerOrder)
          .values({
            id: orderId,
            reference,
            customerId: owner.kind === "customer" ? owner.customerId : null,
            guestCartHash: owner.kind === "guest" ? owner.guestCartHash : null,
            guestAccessTokenHash: guestCredential
              ? sha256(guestCredential)
              : null,
            guestAccessExpiresAt: guestCredential
              ? sql`now() + interval '30 days'`
              : null,
            quoteId: quote.id,
            cartRevision: quote.cartRevision,
            reservationId: reservation.id,
            addressCiphertext: encryptedAddress,
            status: "awaiting_confirmation",
            serviceability: "pending_manual_review",
            paymentMethod: "cod",
            collectionStatus: "uncollected",
            fulfillmentStatus: "not_started",
            merchandiseGrossBdt: quote.merchandiseGrossBdt,
            deliveryAmountBdt: quote.delivery.grossAmountBdt,
            totalBdt: quote.totalBdt,
            codAmountDueBdt: quote.totalBdt,
            taxSnapshot: {
              profileVersion: quote.tax.profileVersion,
              sourceReference: quote.tax.sourceReference,
              sourceVersion: quote.tax.sourceVersion,
              roundingRule: quote.tax.roundingRule,
              merchandise: quote.tax.merchandise,
              delivery: quote.delivery.tax,
              totalTaxAmountBdt: quote.tax.totalTaxAmountBdt,
            },
            deliverySnapshot: {
              tariffVersion: quote.delivery.tariffVersion,
              effectiveFrom: quote.delivery.effectiveFrom,
              geographyVersion: quote.destination.geographyVersion,
              divisionId: quote.destination.divisionId,
              districtId: quote.destination.districtId,
              upazilaId: quote.destination.upazilaId,
            },
          })
          .returning();
        if (!row) throw new Error("Order insert returned no row.");

        await transaction.insert(customerOrderLine).values(
          quote.lines.map((line) => ({
            orderId,
            variantId: line.variantId,
            quantity: line.quantity,
            unitPriceBdt: line.unitPriceBdt,
            grossAmountBdt: line.grossAmountBdt,
            productSnapshot: {
              productName: line.productName,
              color: line.color,
              sizeLabel: line.sizeLabel,
            },
          })),
        );
        await transaction.insert(orderIdempotency).values({
          ownerHash,
          keyHash,
          requestFingerprint,
          orderId,
        });
        await this.audit.append(transaction, {
          actorType: owner.kind === "customer" ? "user" : "anonymous",
          ...(owner.kind === "customer" ? { actorId: owner.customerId } : {}),
          eventType: "commerce.cod_order_created",
          subjectType: "order",
          subjectId: orderId,
          metadata: {
            quoteId: quote.id,
            reservationId: reservation.id,
            lineCount: quote.lines.length,
            totalBdt: quote.totalBdt,
            serviceability: "pending_manual_review",
          },
        });

        if (owner.kind === "customer") {
          const cleared = await this.cart.clearCustomerCartForCheckout(
            transaction,
            owner.customerId,
            quote.cartRevision,
          );
          if (!cleared) {
            throw new ConflictException(
              "The cart changed during checkout. Request a fresh quote.",
              { errorCode: "CART_REVISION_STALE" },
            );
          }
        }
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotencyReplay(
          ownerHash,
          keyHash,
          requestFingerprint,
        );
        if (existing) {
          return this.resolveReplay(
            existing,
            owner,
            idempotencyKey,
            signedCookies,
          );
        }
        throw new ConflictException(
          "This quote has already been used or checkout changed. Request a fresh quote.",
          { errorCode: "ORDER_CHECKOUT_CONFLICT" },
        );
      }
      throw error;
    }

    if (owner.kind === "guest") {
      try {
        await this.cart.clearGuestCartAfterCheckout(
          guestCartId,
          quote.cartRevision,
        );
      } catch {
        this.logger.warn(
          "Guest cart cleanup deferred after COD Order creation.",
        );
      }
    }
    return {
      order: toCreated(saved, replayed),
      guestCredential: guestCredential ?? null,
    };
  }

  async prepareGuestCheckoutAccess(
    customerId: string | undefined,
    guestCartId: string | undefined,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
  ): Promise<string | null> {
    if (customerId) return null;
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (context.owner?.kind !== "guest") throw orderNotFound();
    const ownerHash = hashOwner(context.owner);
    const keyHash = sha256(idempotencyKey);
    const attemptCookieName = guestOrderAttemptCookieName(idempotencyKey);
    const currentAttempt = signedCookies[attemptCookieName];
    const [prior] = await this.database.db
      .select()
      .from(orderIdempotency)
      .where(
        and(
          eq(orderIdempotency.ownerHash, ownerHash),
          eq(orderIdempotency.keyHash, keyHash),
        ),
      )
      .limit(1);
    if (prior) {
      const row = await this.database.db.transaction((transaction) =>
        loadOrderRow(transaction, prior.orderId),
      );
      if (!row) throw new Error("Idempotency record has no Order.");
      if (
        isGuestAttemptCredential(currentAttempt, idempotencyKey) &&
        (await this.matchesGuestCredential(row, currentAttempt))
      ) {
        return currentAttempt;
      }
      const orderCookie = signedCookies[guestOrderCookieName(row.id)];
      if (await this.matchesGuestCredential(row, orderCookie)) return null;
      throw orderAccessUnavailable();
    }
    if (isGuestAttemptCredential(currentAttempt, idempotencyKey)) {
      return currentAttempt;
    }
    return `v1.${idempotencyKey}.${randomBytes(32).toString("base64url")}`;
  }

  async replayCheckout(
    customerId: string | undefined,
    guestCartId: string | undefined,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
  ): Promise<{ order: OrderCreated; guestCredential: string | null }> {
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner) throw orderNotFound();
    const row = await this.findIdempotencyReplay(
      hashOwner(context.owner),
      sha256(idempotencyKey),
      undefined,
    );
    if (!row) {
      throw new NotFoundException("No completed checkout was found.", {
        errorCode: "CHECKOUT_NOT_FOUND",
      });
    }
    return this.resolveReplay(
      row,
      context.owner,
      idempotencyKey,
      signedCookies,
    );
  }

  private async resolveReplay(
    row: OrderRow,
    owner: CartQuoteOwner,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
  ): Promise<{ order: OrderCreated; guestCredential: string | null }> {
    if (owner.kind === "customer") {
      if (row.customerId !== owner.customerId) throw orderNotFound();
      return { order: toCreated(row, true), guestCredential: null };
    }
    if (row.customerId !== null || row.guestCartHash !== owner.guestCartHash) {
      throw orderNotFound();
    }
    const attemptName = guestOrderAttemptCookieName(idempotencyKey);
    const attempt = signedCookies[attemptName];
    if (
      isGuestAttemptCredential(attempt, idempotencyKey) &&
      (await this.matchesGuestCredential(row, attempt))
    ) {
      return { order: toCreated(row, true), guestCredential: attempt };
    }
    const existingOrderCookie = signedCookies[guestOrderCookieName(row.id)];
    if (await this.matchesGuestCredential(row, existingOrderCookie)) {
      return { order: toCreated(row, true), guestCredential: null };
    }
    throw orderAccessUnavailable();
  }

  private async matchesGuestCredential(
    row: OrderRow,
    candidate: string | undefined,
  ): Promise<boolean> {
    if (
      !row.guestAccessTokenHash ||
      !row.guestAccessExpiresAt ||
      !isGuestAccessCredential(candidate)
    ) {
      return false;
    }
    const candidateHash = Buffer.from(sha256(candidate), "hex");
    const storedHash = Buffer.from(row.guestAccessTokenHash, "hex");
    if (
      candidateHash.length !== storedHash.length ||
      !timingSafeEqual(candidateHash, storedHash)
    ) {
      return false;
    }
    const [valid] = await this.database.db
      .select({
        valid: sql<boolean>`${customerOrder.guestAccessExpiresAt} > now()`,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, row.id));
    return valid?.valid === true;
  }

  async getForOwner(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<Order> {
    const [row] = await this.database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!row) throw orderNotFound();

    const authorizedCustomer =
      customerId !== undefined && row.customerId === customerId;
    const authorizedGuest =
      row.customerId === null &&
      (await this.hasValidGuestCredential(row, signedCookies));
    if (!authorizedCustomer && !authorizedGuest) throw orderNotFound();
    return this.loadPrivateOrder(row);
  }

  async listForManagement(
    query: OrderListQuery,
  ): Promise<ReturnType<typeof OrderManagementListSchema.parse>> {
    const rows = await this.database.db
      .select({
        id: customerOrder.id,
        reference: customerOrder.reference,
        status: customerOrder.status,
        serviceability: customerOrder.serviceability,
        totalBdt: customerOrder.totalBdt,
        createdAt: customerOrder.createdAt,
      })
      .from(customerOrder)
      .orderBy(desc(customerOrder.createdAt), desc(customerOrder.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    return OrderManagementListSchema.parse({
      rows: rows.slice(0, query.limit).map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      limit: query.limit,
      offset: query.offset,
      hasMore: rows.length > query.limit,
    });
  }

  async getForManagement(orderId: string): Promise<Order> {
    const [row] = await this.database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!row) throw orderNotFound();
    return this.loadPrivateOrder(row);
  }

  async reviewServiceability(
    orderId: string,
    staffId: string,
    input: OrderServiceabilityInput,
  ): Promise<Order> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (
        row.serviceability === input.outcome &&
        (row.status === "confirmed" || row.status === "rejected")
      ) {
        return;
      }
      if (
        row.status !== "awaiting_confirmation" ||
        row.serviceability !== "pending_manual_review"
      ) {
        throw new ConflictException(
          "This Order is no longer awaiting serviceability review.",
          { errorCode: "ORDER_REVIEW_ALREADY_COMPLETED" },
        );
      }

      const [reviewed] = await transaction
        .update(customerOrder)
        .set({
          status: input.outcome === "serviceable" ? "confirmed" : "rejected",
          serviceability: input.outcome,
          fulfillmentStatus:
            input.outcome === "serviceable" ? "awaiting_dispatch" : "cancelled",
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(customerOrder.id, row.id),
            eq(customerOrder.status, "awaiting_confirmation"),
            eq(customerOrder.serviceability, "pending_manual_review"),
            sql`${customerOrder.createdAt} > clock_timestamp() - ${ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS} * interval '1 hour'`,
          ),
        )
        .returning({ id: customerOrder.id });

      if (!reviewed) {
        await this.cancelExpiredServiceabilityReview(transaction, row);
        return;
      }

      if (input.outcome === "unserviceable") {
        await this.inventory.releaseWithinTransaction(transaction, {
          commandId: randomUUID(),
          reservationId: row.reservationId,
        });
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType:
          input.outcome === "serviceable"
            ? "commerce.cod_order_serviceable_confirmed"
            : "commerce.cod_order_rejected_unserviceable",
        subjectType: "order",
        subjectId: row.id,
        reason: input.reason,
        metadata: { outcome: input.outcome },
      });
    });
    return this.getForManagement(orderId);
  }

  async expirePendingServiceabilityReviews(batchSize = 50): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new RangeError("Serviceability expiry batch size must be 1–500.");
    }

    let cancelledCount = 0;
    const failedOrderIds: string[] = [];
    for (let attempt = 0; attempt < batchSize; attempt += 1) {
      let cancelled: boolean;
      try {
        cancelled = await this.database.db.transaction(async (transaction) => {
          const [row] = await transaction
            .select({
              id: customerOrder.id,
              reservationId: customerOrder.reservationId,
            })
            .from(customerOrder)
            .where(
              and(
                eq(customerOrder.status, "awaiting_confirmation"),
                eq(customerOrder.serviceability, "pending_manual_review"),
                sql`${customerOrder.createdAt} <= clock_timestamp() - ${ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS} * interval '1 hour'`,
                failedOrderIds.length
                  ? notInArray(customerOrder.id, failedOrderIds)
                  : undefined,
              ),
            )
            .orderBy(asc(customerOrder.createdAt), asc(customerOrder.id))
            .limit(1)
            .for("update", { skipLocked: true });
          if (!row) return false;
          try {
            return await this.cancelExpiredServiceabilityReview(
              transaction,
              row,
            );
          } catch (cause) {
            throw new ServiceabilityExpiryTransitionError(row.id, { cause });
          }
        });
      } catch (error) {
        if (!(error instanceof ServiceabilityExpiryTransitionError))
          throw error;
        failedOrderIds.push(error.orderId);
        this.logger.error("A pending COD Order could not be expired.");
        continue;
      }
      if (!cancelled) break;
      cancelledCount += 1;
    }
    return cancelledCount;
  }

  private async cancelExpiredServiceabilityReview(
    transaction: AuditTransaction,
    row: Pick<OrderRow, "id" | "reservationId">,
  ): Promise<boolean> {
    const [cancelled] = await transaction
      .update(customerOrder)
      .set({
        status: "cancelled",
        fulfillmentStatus: "cancelled",
        cancellationReason: "serviceability_review_timeout",
        cancelledAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(customerOrder.id, row.id),
          eq(customerOrder.status, "awaiting_confirmation"),
          eq(customerOrder.serviceability, "pending_manual_review"),
          sql`${customerOrder.createdAt} <= clock_timestamp() - ${ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS} * interval '1 hour'`,
        ),
      )
      .returning({ cancelledAt: customerOrder.cancelledAt });
    if (!cancelled?.cancelledAt) return false;

    await this.inventory.releaseWithinTransaction(transaction, {
      commandId: randomUUID(),
      reservationId: row.reservationId,
    });
    await this.audit.append(transaction, {
      actorType: "service",
      eventType: "commerce.cod_order_manual_review_timeout_cancelled",
      subjectType: "order",
      subjectId: row.id,
      occurredAt: cancelled.cancelledAt,
      reason: "Serviceability was not reviewed within 7 days.",
      metadata: {
        cancellationReason: "serviceability_review_timeout",
        reviewDeadlineHours: ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS,
        reservationId: row.reservationId,
      },
    });
    return true;
  }

  private async resolveAddress(
    input: CheckoutAddressInput,
  ): Promise<NormalizedAddress> {
    const phone = normalizeBangladeshMobile(input.phone);
    const destination = await this.geography.resolveDestination({
      geographyVersion: input.geographyVersion,
      divisionId: input.divisionId,
      districtId: input.districtId,
      ...(input.upazilaId ? { upazilaId: input.upazilaId } : {}),
    });
    return OrderAddressSchema.parse({
      recipientName: normalizeAddressText(input.recipientName),
      phone,
      geographyVersion: input.geographyVersion,
      divisionId: destination.division.id,
      divisionName: destination.division.name,
      districtId: destination.district.id,
      districtName: destination.district.name,
      upazilaId: destination.upazila?.id ?? null,
      upazilaName: destination.upazila?.name ?? null,
      locality: normalizeAddressText(input.locality),
      doorstepDetails: normalizeAddressText(input.doorstepDetails),
      street: optionalAddressText(input.street),
      house: optionalAddressText(input.house),
      postalCode: optionalAddressText(input.postalCode),
      instructions: optionalAddressText(input.instructions),
    });
  }

  private async findIdempotencyReplay(
    ownerHash: string,
    keyHash: string,
    fingerprint: string | undefined,
  ): Promise<OrderRow | null> {
    const [prior] = await this.database.db
      .select()
      .from(orderIdempotency)
      .where(
        and(
          eq(orderIdempotency.ownerHash, ownerHash),
          eq(orderIdempotency.keyHash, keyHash),
        ),
      )
      .limit(1);
    if (!prior) return null;
    if (fingerprint !== undefined) {
      assertIdempotencyFingerprint(prior, fingerprint);
    }
    const row = await this.database.db.transaction((transaction) =>
      loadOrderRow(transaction, prior.orderId),
    );
    if (!row) throw new Error("Idempotency record has no Order.");
    return row;
  }

  private async hasValidGuestCredential(
    row: OrderRow,
    signedCookies: Record<string, string>,
  ): Promise<boolean> {
    return this.matchesGuestCredential(
      row,
      signedCookies[guestOrderCookieName(row.id)],
    );
  }

  private async loadPrivateOrder(row: OrderRow): Promise<Order> {
    const lines = await this.database.db
      .select()
      .from(customerOrderLine)
      .where(eq(customerOrderLine.orderId, row.id))
      .orderBy(asc(customerOrderLine.variantId));
    const address = decryptAddress(
      row.addressCiphertext,
      row.id,
      getOrderPiiKey(),
    );
    return OrderSchema.parse({
      id: row.id,
      reference: row.reference,
      currency: "BDT",
      status: row.status,
      serviceability: row.serviceability,
      paymentMethod: row.paymentMethod,
      collectionStatus: row.collectionStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      lines: lines.map((line) => ({
        variantId: line.variantId,
        ...(typeof line.productSnapshot === "object" &&
        line.productSnapshot !== null
          ? line.productSnapshot
          : {}),
        quantity: line.quantity,
        unitPriceBdt: line.unitPriceBdt,
        grossAmountBdt: line.grossAmountBdt,
      })),
      merchandiseGrossBdt: row.merchandiseGrossBdt,
      tax: row.taxSnapshot,
      delivery: {
        tariffVersion: (row.deliverySnapshot as { tariffVersion: string })
          .tariffVersion,
        effectiveFrom: (row.deliverySnapshot as { effectiveFrom: string })
          .effectiveFrom,
        grossAmountBdt: row.deliveryAmountBdt,
      },
      totalBdt: row.totalBdt,
      codAmountDueBdt: row.codAmountDueBdt,
      cancellationReason: row.cancellationReason ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      address,
      createdAt: row.createdAt.toISOString(),
      guestAccessExpiresAt: row.guestAccessExpiresAt?.toISOString() ?? null,
    });
  }
}

export function guestOrderCookieName(orderId: string): string {
  return `${ORDER_GUEST_COOKIE_PREFIX}${orderId}`;
}

export function guestOrderAttemptCookieName(idempotencyKey: string): string {
  return `${ORDER_ATTEMPT_COOKIE_PREFIX}${idempotencyKey}`;
}

function isGuestAttemptCredential(
  value: string | null | undefined,
  idempotencyKey: string,
): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(`v1.${idempotencyKey}.`) &&
    isGuestAccessCredential(value)
  );
}

function isGuestAccessCredential(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value)
  );
}

export function normalizeBangladeshMobile(value: string): string {
  const asciiDigits = value
    .normalize("NFKC")
    .replace(/[০-৯]/g, (character) => String(character.charCodeAt(0) - 0x09e6));
  const compact = asciiDigits.replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("+8801")
    ? compact
    : compact.startsWith("8801")
      ? `+${compact}`
      : /^01[3-9]\d{8}$/.test(compact)
        ? `+88${compact}`
        : "";
  if (!/^\+8801[3-9]\d{8}$/.test(normalized)) {
    throw new UnprocessableEntityException(
      "Enter a valid Bangladesh mobile number (01XXXXXXXXX or +8801XXXXXXXXX).",
      { errorCode: "ORDER_PHONE_INVALID" },
    );
  }
  return normalized;
}

function normalizeCheckoutInput(
  input: CheckoutAddressInput,
): CheckoutAddressInput {
  return {
    ...input,
    recipientName: normalizeAddressText(input.recipientName),
    phone: normalizeBangladeshMobile(input.phone),
    locality: normalizeAddressText(input.locality),
    doorstepDetails: normalizeAddressText(input.doorstepDetails),
    ...(input.street !== undefined
      ? { street: optionalAddressText(input.street) ?? "" }
      : {}),
    ...(input.house !== undefined
      ? { house: optionalAddressText(input.house) ?? "" }
      : {}),
    ...(input.postalCode !== undefined
      ? { postalCode: optionalAddressText(input.postalCode) ?? "" }
      : {}),
    ...(input.instructions !== undefined
      ? { instructions: optionalAddressText(input.instructions) ?? "" }
      : {}),
  };
}

function normalizeAddressText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function optionalAddressText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = normalizeAddressText(value);
  return normalized || null;
}

function sameDestination(
  quote: Awaited<ReturnType<QuoteService["getCurrentForCheckout"]>>,
  address: CheckoutAddressInput,
): boolean {
  return (
    quote.destination.geographyVersion === address.geographyVersion &&
    quote.destination.divisionId === address.divisionId &&
    quote.destination.districtId === address.districtId &&
    quote.destination.upazilaId === (address.upazilaId ?? null)
  );
}

function hashOwner(owner: CartQuoteOwner): string {
  const value =
    owner.kind === "customer"
      ? `customer:${owner.customerId}`
      : `guest:${owner.guestCartHash}`;
  return sha256(value);
}

function fingerprintCheckout(
  quoteId: string,
  address: CheckoutAddressInput,
  key: Buffer,
): string {
  return createHmac("sha256", key)
    .update(JSON.stringify({ version: 1, quoteId, address }))
    .digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertIdempotencyFingerprint(
  prior: IdempotencyRow,
  fingerprint: string,
): void {
  if (prior.requestFingerprint !== fingerprint) {
    throw new ConflictException(
      "This idempotency key was already used with different checkout details.",
      { errorCode: "IDEMPOTENCY_KEY_REUSED" },
    );
  }
}

async function lockOrderIdempotency(
  transaction: AuditTransaction,
  ownerHash: string,
  keyHash: string,
): Promise<void> {
  const resource = JSON.stringify([
    "aaraj/order-checkout/v1",
    ownerHash,
    keyHash,
  ]);
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`,
  );
}

async function loadOrderRow(
  transaction: AuditTransaction,
  id: string,
): Promise<OrderRow | null> {
  const [row] = await transaction
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.id, id))
    .limit(1);
  return row ?? null;
}

function toCreated(row: OrderRow, replayed: boolean): OrderCreated {
  return OrderCreatedSchema.parse({
    id: row.id,
    reference: row.reference,
    totalBdt: row.totalBdt,
    codAmountDueBdt: row.codAmountDueBdt,
    status: row.status,
    serviceability: row.serviceability,
    paymentMethod: row.paymentMethod,
    collectionStatus: row.collectionStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    createdAt: row.createdAt.toISOString(),
    guestAccessExpiresAt: row.guestAccessExpiresAt?.toISOString() ?? null,
    replayed,
  });
}

function encryptAddress(
  address: NormalizedAddress,
  orderId: string,
  key: Buffer,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`aaraj/order-address/v1:${orderId}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(address), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptAddress(value: string, orderId: string, key: Buffer) {
  try {
    const [version, nonceValue, ciphertextValue, tagValue, extra] =
      value.split(".");
    if (
      version !== "v1" ||
      !nonceValue ||
      !ciphertextValue ||
      !tagValue ||
      extra
    ) {
      throw new Error("invalid ciphertext envelope");
    }
    const nonce = Buffer.from(nonceValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(`aaraj/order-address/v1:${orderId}`));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return OrderAddressSchema.parse(JSON.parse(plaintext));
  } catch {
    throw new ServiceUnavailableException(
      "The protected Order address could not be read.",
      { errorCode: "ORDER_ADDRESS_UNAVAILABLE" },
    );
  }
}

function getOrderPiiKey(): Buffer {
  const encoded = process.env.ORDER_PII_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error("ORDER_PII_ENCRYPTION_KEY must be configured.");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error(
      "ORDER_PII_ENCRYPTION_KEY must be a canonical base64url encoding of 32 random bytes.",
    );
  }
  return key;
}

function orderNotFound(): NotFoundException {
  return new NotFoundException("Order not found.", {
    errorCode: "ORDER_NOT_FOUND",
  });
}

function orderAccessUnavailable(): ConflictException {
  return new ConflictException(
    "Online guest Order access is unavailable and cannot be restored automatically.",
    { errorCode: "ORDER_ACCESS_UNAVAILABLE" },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

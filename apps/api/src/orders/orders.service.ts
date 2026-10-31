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
  DeliveryZoneSchema,
  OrderManagementListSchema,
  OrderSchema,
  MAX_LIST_OFFSET,
  type CheckoutAddressInput,
  type CreateOrderInput,
  type Order,
  type OrderAddress,
  type OrderCreated,
  type OrderDispatchInput,
  type OrderCancellationInput,
  type OrderCollectionInput,
  type OrderFulfillmentOutcomeInput,
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
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { CartService, type CartQuoteOwner } from "../cart/cart.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  readOrderPiiKeyring,
  type OrderPiiKeyring,
} from "../platform/crypto/order-pii-keyring.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { GeographyService } from "../geography/geography.service.js";
import {
  INVENTORY_RESERVATION_PORT,
  type InventoryReservationPort,
} from "../inventory/inventory-reservation.port.js";
import { QuoteService } from "../quote/quote.service.js";
import type {
  OrdersPathaoPort,
  PathaoBookingClaimSnapshot,
  PathaoFulfillmentSnapshot,
  PathaoOrderBookingSnapshot,
} from "./orders-pathao.port.js";
import {
  customerOrder,
  customerOrderLine,
  orderIdempotency,
  orderReferenceCounter,
  orderPathaoBookingClaim,
} from "./orders-schema.js";
import type {
  PathaoBookingClaimUpdate,
  PathaoOrderReference,
} from "./orders-pathao.port.js";

const ORDER_GUEST_COOKIE_PREFIX = "aaraj_order_";
const ORDER_ATTEMPT_COOKIE_PREFIX = "aaraj_order_attempt_";
const MAX_ORDER_LINES = 50;

type OrderRow = typeof customerOrder.$inferSelect;
type IdempotencyRow = typeof orderIdempotency.$inferSelect;
type NormalizedAddress = OrderAddress;
@Injectable()
export class OrdersService implements OrdersPathaoPort {
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
    const piiKeyring = readOrderPiiKeyring();
    const requestFingerprint = fingerprintCheckout(
      input.quoteId,
      normalizedInput,
      piiKeyring.keys.get("legacy")!,
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
    const encryptedAddress = encryptAddress(address, orderId, piiKeyring);

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

        await this.quotes.lockAndValidateForOrderCheckout(transaction, quote);

        const [counter] = await transaction
          .insert(orderReferenceCounter)
          .values({
            year: sql<number>`extract(year from now() at time zone 'Asia/Dhaka')::integer`,
            lastNumber: 1,
          })
          .onConflictDoUpdate({
            target: orderReferenceCounter.year,
            set: {
              lastNumber: sql`${orderReferenceCounter.lastNumber} + 1`,
            },
          })
          .returning({
            year: orderReferenceCounter.year,
            number: orderReferenceCounter.lastNumber,
          });
        if (!counter) throw new Error("Order reference allocation failed.");
        const reference = formatOrderReference(counter.year, counter.number);

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
            deliverySnapshot: {
              tariffVersion: quote.delivery.tariffVersion,
              effectiveFrom: quote.delivery.effectiveFrom,
              zone: quote.delivery.zone,
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
    const searchPattern = query.search
      ? `%${escapeLikeWildcards(query.search)}%`
      : undefined;
    const rows = await this.database.db
      .select({
        id: customerOrder.id,
        reference: customerOrder.reference,
        addressCiphertext: customerOrder.addressCiphertext,
        deliverySnapshot: customerOrder.deliverySnapshot,
        status: customerOrder.status,
        fulfillmentStatus: customerOrder.fulfillmentStatus,
        collectionStatus: customerOrder.collectionStatus,
        deliveryProvider: customerOrder.deliveryProvider,
        codAmountDueBdt: customerOrder.codAmountDueBdt,
        createdAt: customerOrder.createdAt,
      })
      .from(customerOrder)
      .where(
        and(
          searchPattern
            ? ilike(customerOrder.reference, searchPattern)
            : undefined,
          query.fulfillmentStatus
            ? eq(customerOrder.fulfillmentStatus, query.fulfillmentStatus)
            : undefined,
        ),
      )
      .orderBy(desc(customerOrder.createdAt), desc(customerOrder.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const candidateNextOffset = query.offset + query.limit;
    const pageOrderIds = pageRows.map((row) => row.id);
    const lineRows =
      pageOrderIds.length > 0
        ? await this.database.db
            .select({
              orderId: customerOrderLine.orderId,
              variantId: customerOrderLine.variantId,
              quantity: customerOrderLine.quantity,
              productSnapshot: customerOrderLine.productSnapshot,
            })
            .from(customerOrderLine)
            .where(inArray(customerOrderLine.orderId, pageOrderIds))
            .orderBy(
              asc(customerOrderLine.orderId),
              asc(customerOrderLine.variantId),
            )
        : [];
    const linesByOrderId = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      const lines = linesByOrderId.get(line.orderId) ?? [];
      lines.push(line);
      linesByOrderId.set(line.orderId, lines);
    }
    const piiKeyring = readOrderPiiKeyring();
    return OrderManagementListSchema.parse({
      rows: pageRows.map((row) => {
        const address = decryptAddress(
          row.addressCiphertext,
          row.id,
          piiKeyring,
        );
        return {
          id: row.id,
          reference: row.reference,
          customerName: address.recipientName,
          customerPhone: address.phone,
          deliveryZone: parseDeliveryZone(row.deliverySnapshot),
          items: (linesByOrderId.get(row.id) ?? []).map((line) => ({
            ...parseOrderLineProduct(line.productSnapshot),
            quantity: line.quantity,
          })),
          status: row.status,
          fulfillmentStatus: row.fulfillmentStatus,
          collectionStatus: row.collectionStatus,
          deliveryProvider: row.deliveryProvider,
          codAmountDueBdt: row.codAmountDueBdt,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
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

  async getPathaoBookingSnapshot(
    orderId: string,
  ): Promise<PathaoOrderBookingSnapshot> {
    const [row] = await this.database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!row) throw orderNotFound();
    if (
      row.status !== "confirmed" ||
      row.serviceability !== "serviceable" ||
      row.fulfillmentStatus !== "awaiting_dispatch"
    ) {
      throw new ConflictException(
        "Only confirmed, serviceable Orders awaiting dispatch can be booked with Pathao.",
        { errorCode: "PATHAO_ORDER_NOT_ELIGIBLE" },
      );
    }
    const order = await this.loadPrivateOrder(row);
    const address = order.address;
    const recipientAddress = [
      address.house,
      address.street,
      address.locality,
      address.doorstepDetails,
      address.upazilaName,
      address.districtName,
      address.divisionName,
      address.postalCode,
    ]
      .filter((value): value is string => Boolean(value))
      .join(", ");
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      serviceability: order.serviceability,
      fulfillmentStatus: order.fulfillmentStatus,
      recipientName: order.address.recipientName,
      recipientPhone: order.address.phone,
      recipientAddress,
      customerInstructions: order.address.instructions,
      itemQuantity: order.lines.reduce(
        (total, line) => total + line.quantity,
        0,
      ),
      codAmountDueBdt: order.codAmountDueBdt,
    };
  }

  async getPathaoBookingClaimStatus(
    orderId: string,
  ): Promise<
    | "submitting"
    | "booked"
    | "outcome_unknown"
    | "reconciliation_required"
    | null
  > {
    const [claim] = await this.database.db
      .select({ status: orderPathaoBookingClaim.status })
      .from(orderPathaoBookingClaim)
      .where(eq(orderPathaoBookingClaim.orderId, orderId))
      .limit(1);
    return claim?.status ?? null;
  }

  async getPathaoBookingClaimStatuses(
    orderIds: readonly string[],
  ): Promise<PathaoBookingClaimSnapshot[]> {
    if (orderIds.length === 0) return [];
    return this.database.db
      .select({
        orderId: orderPathaoBookingClaim.orderId,
        status: orderPathaoBookingClaim.status,
      })
      .from(orderPathaoBookingClaim)
      .where(inArray(orderPathaoBookingClaim.orderId, [...orderIds]));
  }

  async beginPathaoBookingClaim(
    orderId: string,
    commandId: string,
    requestFingerprint: string,
    status: "submitting" | "reconciliation_required",
  ): Promise<PathaoOrderBookingSnapshot> {
    return this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (
        row.status !== "confirmed" ||
        row.serviceability !== "serviceable" ||
        row.fulfillmentStatus !== "awaiting_dispatch"
      ) {
        throw new ConflictException(
          "Only confirmed, serviceable Orders awaiting dispatch can be booked with Pathao.",
          { errorCode: "PATHAO_ORDER_NOT_ELIGIBLE" },
        );
      }
      const [claim] = await transaction
        .select()
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, orderId))
        .for("update")
        .limit(1);
      if (claim) {
        if (
          claim.commandId === commandId &&
          claim.requestFingerprint === requestFingerprint
        ) {
          return this.pathaoSnapshotFromRow(row);
        }
        if (
          status !== "reconciliation_required" ||
          !["outcome_unknown", "reconciliation_required"].includes(claim.status)
        ) {
          throw new ConflictException(
            "This Order has an active or unresolved Pathao booking claim.",
            { errorCode: "PATHAO_BOOKING_ALREADY_EXISTS" },
          );
        }
        await transaction
          .update(orderPathaoBookingClaim)
          .set({
            commandId,
            requestFingerprint,
            status,
            lastErrorCode: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(orderPathaoBookingClaim.orderId, orderId));
      } else {
        await transaction.insert(orderPathaoBookingClaim).values({
          orderId,
          commandId,
          requestFingerprint,
          status,
        });
      }
      return this.pathaoSnapshotFromRow(row);
    });
  }

  async setPathaoBookingClaim(update: PathaoBookingClaimUpdate): Promise<void> {
    await this.database.db
      .insert(orderPathaoBookingClaim)
      .values({
        ...update,
        updatedAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: orderPathaoBookingClaim.orderId,
        set: {
          status: update.status,
          lastErrorCode: update.lastErrorCode,
          updatedAt: sql`clock_timestamp()`,
        },
        setWhere: and(
          eq(orderPathaoBookingClaim.commandId, update.commandId),
          eq(
            orderPathaoBookingClaim.requestFingerprint,
            update.requestFingerprint,
          ),
        ),
      });
  }

  async assertPathaoBookingClaim(
    orderId: string,
    commandId: string,
    requestFingerprint: string,
  ): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ id: customerOrder.id })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      const [claim] = await transaction
        .select()
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, orderId))
        .for("update")
        .limit(1);
      if (
        !claim ||
        claim.commandId !== commandId ||
        claim.requestFingerprint !== requestFingerprint ||
        claim.status !== "submitting"
      ) {
        throw new ConflictException(
          "The Pathao booking intent expired before a provider request could be sent.",
          { errorCode: "PATHAO_BOOKING_CLAIM_EXPIRED" },
        );
      }
    });
  }

  async recoverPathaoBookingClaims(
    activeOrderIds: readonly string[],
  ): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      const stale = await transaction
        .select({ orderId: orderPathaoBookingClaim.orderId })
        .from(orderPathaoBookingClaim)
        .where(
          sql`${orderPathaoBookingClaim.status} = 'submitting' and ${orderPathaoBookingClaim.updatedAt} <= clock_timestamp() - interval '15 seconds'`,
        )
        .for("update", { skipLocked: true })
        .limit(100);
      const orphanIds = stale
        .map((claim) => claim.orderId)
        .filter((id) => !activeOrderIds.includes(id));
      if (orphanIds.length > 0) {
        await transaction
          .delete(orderPathaoBookingClaim)
          .where(inArray(orderPathaoBookingClaim.orderId, orphanIds));
      }
    });
  }

  async getOrderReferences(
    orderIds: readonly string[],
  ): Promise<PathaoOrderReference[]> {
    if (orderIds.length === 0) return [];
    return this.database.db
      .select({ id: customerOrder.id, reference: customerOrder.reference })
      .from(customerOrder)
      .where(inArray(customerOrder.id, [...new Set(orderIds)]));
  }

  private async pathaoSnapshotFromRow(
    row: OrderRow,
  ): Promise<PathaoOrderBookingSnapshot> {
    const order = await this.loadPrivateOrder(row);
    const address = order.address;
    const recipientAddress = [
      address.house,
      address.street,
      address.locality,
      address.doorstepDetails,
      address.upazilaName,
      address.districtName,
      address.divisionName,
      address.postalCode,
    ]
      .filter((value): value is string => Boolean(value))
      .join(", ");
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      serviceability: order.serviceability,
      fulfillmentStatus: order.fulfillmentStatus,
      recipientName: address.recipientName,
      recipientPhone: address.phone,
      recipientAddress,
      customerInstructions: address.instructions,
      itemQuantity: order.lines.reduce(
        (total, line) => total + line.quantity,
        0,
      ),
      codAmountDueBdt: order.codAmountDueBdt,
    };
  }

  async getPathaoFulfillmentSnapshot(
    orderId: string,
  ): Promise<PathaoFulfillmentSnapshot> {
    const [row] = await this.database.db
      .select({
        fulfillmentStatus: customerOrder.fulfillmentStatus,
        dispatchedAt: customerOrder.dispatchedAt,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!row) throw orderNotFound();
    return {
      fulfillmentStatus: row.fulfillmentStatus,
      dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    };
  }

  async authorizePathaoTrackingRead(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<void> {
    await this.getForOwner(orderId, customerId, signedCookies);
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
          "This Order is no longer pending confirmation or review.",
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
          ),
        )
        .returning({ id: customerOrder.id });

      if (!reviewed) {
        throw new ConflictException(
          "This Order changed before the decision was saved.",
          { errorCode: "ORDER_REVIEW_ALREADY_COMPLETED" },
        );
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
            ? "commerce.cod_order_confirmed"
            : "commerce.cod_order_rejected_unserviceable",
        subjectType: "order",
        subjectId: row.id,
        reason: input.reason,
        metadata: { outcome: input.outcome },
      });
    });
    return this.getForManagement(orderId);
  }

  async dispatch(
    orderId: string,
    staffId: string,
    commandId: string,
    input: OrderDispatchInput,
  ): Promise<Order> {
    const deliveryProvider = input.deliveryProvider ?? "manual";
    const normalizedInput = { ...input, deliveryProvider };
    const fingerprint = fingerprintDispatch(orderId, normalizedInput);
    try {
      await this.database.db.transaction(async (transaction) => {
        const [row] = await transaction
          .select()
          .from(customerOrder)
          .where(eq(customerOrder.id, orderId))
          .for("update")
          .limit(1);
        if (!row) throw orderNotFound();

        if (row.dispatchCommandId !== null) {
          if (
            row.dispatchCommandId !== commandId ||
            row.dispatchRequestFingerprint !== fingerprint
          ) {
            throw new ConflictException(
              "This Order has already been dispatched with a different command or payload.",
              { errorCode: "ORDER_ALREADY_DISPATCHED" },
            );
          }
          return;
        }

        if (
          row.status !== "confirmed" ||
          row.serviceability !== "serviceable" ||
          row.fulfillmentStatus !== "awaiting_dispatch"
        ) {
          throw new ConflictException(
            "Only a confirmed, serviceable Order awaiting dispatch can be dispatched.",
            { errorCode: "ORDER_NOT_DISPATCHABLE" },
          );
        }

        const [pathaoClaim] = await transaction
          .select()
          .from(orderPathaoBookingClaim)
          .where(eq(orderPathaoBookingClaim.orderId, row.id))
          .for("update")
          .limit(1);
        if (
          (pathaoClaim?.status === "booked" && deliveryProvider !== "pathao") ||
          (pathaoClaim && pathaoClaim.status !== "booked") ||
          (!pathaoClaim && deliveryProvider === "pathao")
        ) {
          throw new ConflictException(
            pathaoClaim && pathaoClaim.status !== "booked"
              ? "Resolve the Pathao booking outcome before dispatching this Order."
              : "Dispatch provider must match the Order's confirmed Pathao booking.",
            { errorCode: "ORDER_DELIVERY_PROVIDER_MISMATCH" },
          );
        }

        const orderLines = await transaction
          .select({
            variantId: customerOrderLine.variantId,
            quantity: customerOrderLine.quantity,
          })
          .from(customerOrderLine)
          .where(eq(customerOrderLine.orderId, orderId))
          .orderBy(asc(customerOrderLine.variantId));
        const consumed = await this.inventory.consumeWithinTransaction(
          transaction,
          { commandId, reservationId: row.reservationId },
        );
        if (
          consumed.status !== "consumed" ||
          !sameReservationLines(consumed.lines, orderLines)
        ) {
          throw new ConflictException(
            "The Order reservation does not match its saved item quantities.",
            { errorCode: "ORDER_RESERVATION_MISMATCH" },
          );
        }

        const [dispatched] = await transaction
          .update(customerOrder)
          .set({
            fulfillmentStatus: "dispatched",
            deliveryProvider,
            dispatchCommandId: commandId,
            dispatchRequestFingerprint: fingerprint,
            deliveryOperator: input.deliveryOperator,
            handoffReference: input.handoffReference ?? null,
            dispatchedBy: staffId,
            dispatchedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(customerOrder.id, row.id),
              eq(customerOrder.status, "confirmed"),
              eq(customerOrder.serviceability, "serviceable"),
              eq(customerOrder.fulfillmentStatus, "awaiting_dispatch"),
            ),
          )
          .returning({ dispatchedAt: customerOrder.dispatchedAt });
        if (!dispatched?.dispatchedAt) {
          throw new ConflictException(
            "The Order changed before dispatch could be recorded.",
            { errorCode: "ORDER_NOT_DISPATCHABLE" },
          );
        }

        await this.audit.append(transaction, {
          actorType: "user",
          actorId: staffId,
          eventType: "commerce.cod_order_dispatched",
          subjectType: "order",
          subjectId: row.id,
          occurredAt: dispatched.dispatchedAt,
          metadata: {
            commandId,
            reservationId: row.reservationId,
            deliveryProvider,
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "order_dispatch_command_uidx")) {
        const [existing] = await this.database.db
          .select({
            id: customerOrder.id,
            dispatchRequestFingerprint:
              customerOrder.dispatchRequestFingerprint,
          })
          .from(customerOrder)
          .where(eq(customerOrder.dispatchCommandId, commandId))
          .limit(1);
        if (existing) {
          if (
            existing.id !== orderId ||
            existing.dispatchRequestFingerprint !== fingerprint
          ) {
            throw dispatchCommandConflict();
          }
          return this.getForManagement(orderId);
        }
      }
      throw error;
    }
    return this.getForManagement(orderId);
  }

  async cancelAwaitingDispatch(
    orderId: string,
    staffId: string,
    input: OrderCancellationInput,
  ): Promise<Order> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (row.status === "cancelled") return;
      if (
        row.status !== "confirmed" ||
        row.serviceability !== "serviceable" ||
        row.fulfillmentStatus !== "awaiting_dispatch"
      ) {
        throw new ConflictException(
          "Only confirmed Orders awaiting dispatch can be cancelled.",
          { errorCode: "ORDER_NOT_CANCELLABLE" },
        );
      }

      const [pathaoClaim] = await transaction
        .select({ status: orderPathaoBookingClaim.status })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .limit(1);
      if (pathaoClaim) {
        throw new ConflictException(
          "Resolve the Pathao consignment in the provider system before cancelling this Order.",
          { errorCode: "ORDER_PATHAO_BOOKING_REQUIRES_RECONCILIATION" },
        );
      }

      await this.inventory.releaseWithinTransaction(transaction, {
        commandId: randomUUID(),
        reservationId: row.reservationId,
      });

      const [cancelled] = await transaction
        .update(customerOrder)
        .set({
          status: "cancelled",
          fulfillmentStatus: "cancelled",
          cancellationReason: "staff_cancelled",
          cancelledAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(customerOrder.id, row.id),
            eq(customerOrder.status, "confirmed"),
            eq(customerOrder.fulfillmentStatus, "awaiting_dispatch"),
          ),
        )
        .returning({ cancelledAt: customerOrder.cancelledAt });
      if (!cancelled?.cancelledAt) {
        throw new ConflictException(
          "The Order changed before cancellation could be recorded.",
          { errorCode: "ORDER_NOT_CANCELLABLE" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_cancelled_before_dispatch",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: cancelled.cancelledAt,
        reason: input.reason,
        metadata: {
          cancellationReason: "staff_cancelled",
          reservationId: row.reservationId,
        },
      });
    });
    return this.getForManagement(orderId);
  }

  async recordFulfillmentOutcome(
    orderId: string,
    staffId: string,
    input: OrderFulfillmentOutcomeInput,
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
        row.fulfillmentStatus === input.outcome &&
        row.fulfillmentOutcomeReason === input.reason
      ) {
        return;
      }

      const allowedTransitions: Record<string, readonly string[]> = {
        dispatched: [
          "partially_delivered",
          "delivered",
          "delivery_failed",
          "returned",
        ],
        partially_delivered: ["partially_delivered", "delivered", "returned"],
        delivery_failed: [
          "delivery_failed",
          "partially_delivered",
          "delivered",
          "returned",
        ],
      };
      if (
        !row.dispatchedAt ||
        row.status !== "confirmed" ||
        !allowedTransitions[row.fulfillmentStatus]?.includes(input.outcome)
      ) {
        throw new ConflictException(
          "This delivery outcome is not valid for the current Order state.",
          { errorCode: "ORDER_FULFILLMENT_OUTCOME_CONFLICT" },
        );
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({
          fulfillmentStatus: input.outcome,
          fulfillmentOutcomeReason: input.reason,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(customerOrder.id, row.id),
            eq(customerOrder.status, "confirmed"),
            eq(customerOrder.fulfillmentStatus, row.fulfillmentStatus),
          ),
        )
        .returning({ occurredAt: customerOrder.updatedAt });
      if (!updated?.occurredAt) {
        throw new ConflictException(
          "The Order changed before its delivery outcome could be recorded.",
          { errorCode: "ORDER_FULFILLMENT_OUTCOME_CONFLICT" },
        );
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_fulfillment_outcome_recorded",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          from: row.fulfillmentStatus,
          to: input.outcome,
          deliveryProvider: row.deliveryProvider,
        },
      });
    });
    return this.getForManagement(orderId);
  }

  async recordCodCollection(
    orderId: string,
    staffId: string,
    input: OrderCollectionInput,
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
        row.status !== "confirmed" ||
        !["partially_delivered", "delivered", "returned"].includes(
          row.fulfillmentStatus,
        )
      ) {
        throw new ConflictException(
          "COD collection can be recorded after a delivery or return outcome is verified.",
          { errorCode: "ORDER_COLLECTION_NOT_READY" },
        );
      }
      if (
        row.collectionStatus ===
          (input.collectedAmountBdt === row.codAmountDueBdt
            ? "collected"
            : "discrepancy") &&
        row.collectedAmountBdt === input.collectedAmountBdt &&
        row.collectionReason === input.reason
      ) {
        return;
      }

      const collectionStatus =
        input.collectedAmountBdt === row.codAmountDueBdt
          ? "collected"
          : "discrepancy";
      const [updated] = await transaction
        .update(customerOrder)
        .set({
          collectionStatus,
          collectedAmountBdt: input.collectedAmountBdt,
          collectionReason: input.reason,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(customerOrder.id, row.id))
        .returning({ occurredAt: customerOrder.updatedAt });
      if (!updated?.occurredAt) {
        throw new ConflictException(
          "The Order changed before COD collection could be recorded.",
          { errorCode: "ORDER_COLLECTION_CONFLICT" },
        );
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_collection_reconciled",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          collectionStatus,
          previousCollectionStatus: row.collectionStatus,
          previousCollectedAmountBdt: row.collectedAmountBdt,
          collectedAmountBdt: input.collectedAmountBdt,
          codAmountDueBdt: row.codAmountDueBdt,
        },
      });
    });
    return this.getForManagement(orderId);
  }

  private async resolveAddress(
    input: CheckoutAddressInput,
  ): Promise<NormalizedAddress> {
    const phone = normalizeBangladeshMobile(input.phone);
    const destination = await this.geography.resolveStoredDestination({
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
      readOrderPiiKeyring(),
    );
    return OrderSchema.parse({
      id: row.id,
      reference: row.reference,
      currency: "BDT",
      status: row.status,
      serviceability: row.serviceability,
      paymentMethod: row.paymentMethod,
      collectionStatus: row.collectionStatus,
      collectedAmountBdt: row.collectedAmountBdt,
      fulfillmentStatus: row.fulfillmentStatus,
      dispatch:
        row.dispatchedAt !== null &&
        row.deliveryOperator !== null &&
        row.dispatchCommandId !== null
          ? {
              deliveryProvider: row.deliveryProvider,
              deliveryOperator: row.deliveryOperator,
              handoffReference: row.handoffReference,
              dispatchedAt: row.dispatchedAt.toISOString(),
            }
          : null,
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
      delivery: {
        tariffVersion: (row.deliverySnapshot as { tariffVersion: string })
          .tariffVersion,
        effectiveFrom: (row.deliverySnapshot as { effectiveFrom: string })
          .effectiveFrom,
        zone:
          (
            row.deliverySnapshot as {
              zone?: "inside_dhaka" | "suburban" | "outside_dhaka" | null;
            }
          ).zone ?? null,
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

function formatOrderReference(year: number, number: number) {
  return `ORD-${String(year % 1000).padStart(3, "0")}-${String(number).padStart(5, "0")}`;
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

function fingerprintDispatch(
  orderId: string,
  input: OrderDispatchInput,
): string {
  return sha256(
    JSON.stringify({
      version: 1,
      orderId: orderId.toLowerCase(),
      deliveryProvider: input.deliveryProvider ?? "manual",
      deliveryOperator: input.deliveryOperator,
      handoffReference: input.handoffReference ?? null,
    }),
  );
}

function sameReservationLines(
  reservationLines: readonly { variantId: string; quantity: number }[],
  orderLines: readonly { variantId: string; quantity: number }[],
): boolean {
  return (
    reservationLines.length === orderLines.length &&
    orderLines.every(
      (line, index) =>
        reservationLines[index]?.variantId === line.variantId &&
        reservationLines[index]?.quantity === line.quantity,
    )
  );
}

function dispatchCommandConflict(): ConflictException {
  return new ConflictException(
    "This dispatch command ID was already used for a different Order or payload.",
    { errorCode: "IDEMPOTENCY_KEY_REUSED" },
  );
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
  keyring: OrderPiiKeyring,
): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error("The active Order PII encryption key is missing.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(`aaraj/order-address/v2:${keyring.activeKeyId}:${orderId}`),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(address), "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    keyring.activeKeyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptAddress(
  value: string,
  orderId: string,
  keyring: OrderPiiKeyring,
) {
  try {
    const [version, ...fields] = value.split(".");
    const isV1 = version === "v1" && fields.length === 3;
    const isV2 =
      version === "v2" &&
      fields.length === 4 &&
      /^[A-Za-z0-9_-]+$/.test(fields[0] ?? "");
    if (!isV1 && !isV2) {
      throw new Error("invalid ciphertext envelope");
    }

    const [keyId, nonceValue, ciphertextValue, tagValue] = isV1
      ? ["legacy", ...fields]
      : fields;
    if (!keyId || !nonceValue || !ciphertextValue || !tagValue) {
      throw new Error("ciphertext key or field is unavailable");
    }
    const key = keyring.keys.get(keyId);
    if (!key) throw new Error("ciphertext key is unavailable");

    const nonce = Buffer.from(nonceValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      Buffer.from(
        isV1
          ? `aaraj/order-address/v1:${orderId}`
          : `aaraj/order-address/v2:${keyId}:${orderId}`,
      ),
    );
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

function parseDeliveryZone(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const parsed = DeliveryZoneSchema.safeParse(
    (snapshot as Record<string, unknown>).zone,
  );
  return parsed.success ? parsed.data : null;
}

function parseOrderLineProduct(snapshot: unknown) {
  const product =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
  const productName =
    typeof product.productName === "string" && product.productName.trim()
      ? product.productName.trim()
      : "Product";

  return {
    productName,
    color: typeof product.color === "string" ? product.color : null,
    sizeLabel: typeof product.sizeLabel === "string" ? product.sizeLabel : null,
  };
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

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isUniqueViolation(error: unknown): boolean {
  return postgresError(error)?.code === "23505";
}

function isUniqueConstraintViolation(
  error: unknown,
  constraint: string,
): boolean {
  const cause = postgresError(error);
  return cause?.code === "23505" && cause.constraint === constraint;
}

function postgresError(
  error: unknown,
): { code?: unknown; constraint?: unknown } | null {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current || "constraint" in current) return current;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

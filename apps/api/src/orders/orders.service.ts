import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  OrderAddressSchema,
  OrderCreatedSchema,
  DeliveryZoneSchema,
  OrderManagementDetailSchema,
  OrderManagementListSchema,
  OrderSchema,
  OrderIdSchema,
  OrderReferenceSchema,
  CheckoutDraftPreviewSchema,
  CURRENCY,
  CustomerDirectoryIdSchema,
  ManagedCustomerDirectorySchema,
  ManagedCustomerOrdersPageSchema,
  MAX_ORDER_LINES,
  MAX_LIST_OFFSET,
  MAX_CART_QUANTITY_PER_VARIANT,
  type CheckoutAddressInput,
  type AuthoritativeQuote,
  type CreateOrderInput,
  type OrderItemAddInput,
  type OrderManualDiscountUpdateInput,
  type Order,
  type OrderManagementDetail,
  type OrderAddress,
  type OrderCreated,
  type OrderDispatchInput,
  type OrderCollectionInput,
  type OrderFulfillmentOutcomeInput,
  type OrderListQuery,
  type CustomerDirectoryQuery,
  type CustomerOrdersQuery,
  type OrderStatusUpdateInput,
  type OrderStatusAction,
  type CheckoutDraftCreateOrderInput,
  type CheckoutDraftPreviewInput,
} from "@aaraj/contracts";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { CartService, type CartQuoteOwner } from "../cart/cart.service.js";
import { lockCartOwner } from "../cart/cart-owner-lock.js";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
} from "../catalog/catalog-cart.port.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { readOrderPiiKeyring } from "../platform/crypto/order-pii-keyring.js";
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
  PathaoOrderBookingSnapshot,
} from "./orders-pathao.port.js";
import {
  customerOrder,
  customerOrderLine,
  orderIdempotency,
  orderReferenceCounter,
  orderPathaoBookingClaim,
  checkoutDraft,
} from "./orders-schema.js";
import {
  CheckoutDraftsService,
  draftOwner,
  readDraftGuestCartId,
  readDraftItems,
} from "./checkout-drafts.service.js";
import type {
  PathaoBookingClaimIdentity,
  PathaoBookingClaimUpdate,
  PathaoOrderReference,
} from "./orders-pathao.port.js";

const ORDER_GUEST_COOKIE_PREFIX = "aaraj_order_";
const ORDER_ATTEMPT_COOKIE_PREFIX = "aaraj_order_attempt_";
type OrderRow = typeof customerOrder.$inferSelect;
type PathaoSnapshotOrderRow = Pick<
  OrderRow,
  | "id"
  | "reference"
  | "status"
  | "fulfillmentStatus"
  | "addressSnapshot"
  | "codAmountDueBdt"
>;
type IdempotencyRow = typeof orderIdempotency.$inferSelect;
type CheckoutReplayOrder = Pick<
  OrderRow,
  | "id"
  | "reference"
  | "totalBdt"
  | "codAmountDueBdt"
  | "status"
  | "paymentMethod"
  | "collectionStatus"
  | "fulfillmentStatus"
  | "createdAt"
  | "guestAccessExpiresAt"
  | "customerId"
  | "guestCartHash"
  | "guestAccessTokenHash"
  | "cartRevision"
>;
type OrderCreatedRow = Pick<
  CheckoutReplayOrder,
  | "id"
  | "reference"
  | "totalBdt"
  | "codAmountDueBdt"
  | "status"
  | "paymentMethod"
  | "collectionStatus"
  | "fulfillmentStatus"
  | "createdAt"
  | "guestAccessExpiresAt"
  | "cartRevision"
>;
type OrderItemMutationRow = Pick<
  OrderRow,
  | "id"
  | "status"
  | "fulfillmentStatus"
  | "collectionStatus"
  | "collectedAmountBdt"
  | "merchandiseGrossBdt"
  | "manualDiscountBdt"
  | "deliveryAmountBdt"
  | "reservationId"
  | "totalBdt"
  | "codAmountDueBdt"
>;
type CheckoutReplay = {
  order: CheckoutReplayOrder;
  guestAccessStillValid: boolean;
};
type NormalizedAddress = OrderAddress;
type ManagedOrderListRecord = Pick<
  OrderRow,
  | "id"
  | "reference"
  | "addressSnapshot"
  | "deliverySnapshot"
  | "status"
  | "fulfillmentStatus"
  | "collectionStatus"
  | "deliveryProvider"
  | "codAmountDueBdt"
  | "createdAt"
>;
type CustomerDirectoryRecord = {
  customer_key: string;
  identity_type: "account" | "guest_order";
  account_name: string | null;
  account_email: string | null;
  order_count: string | number;
  last_order_at: Date | string;
  latest_order_id: string;
  latest_order_reference: string;
  latest_order_status: string;
  address_snapshot: unknown;
};

const MANAGED_ORDER_LIST_SELECTION = {
  id: customerOrder.id,
  reference: customerOrder.reference,
  addressSnapshot: customerOrder.addressSnapshot,
  deliverySnapshot: customerOrder.deliverySnapshot,
  status: customerOrder.status,
  fulfillmentStatus: customerOrder.fulfillmentStatus,
  collectionStatus: customerOrder.collectionStatus,
  deliveryProvider: customerOrder.deliveryProvider,
  codAmountDueBdt: customerOrder.codAmountDueBdt,
  createdAt: customerOrder.createdAt,
};

type PersistOrderSnapshotInput = {
  id: string;
  reference: string;
  owner: CartQuoteOwner;
  guestCredential?: string | null;
  quote: AuthoritativeQuote;
  cartRevision: number;
  reservationId: string;
  addressSnapshot: OrderAddress;
  status: "pending" | "confirmed";
  fulfillmentStatus: "not_started" | "awaiting_dispatch";
  sourceDraftId?: string;
  createdByStaffId?: string;
};

async function persistOrderSnapshot(
  transaction: AuditTransaction,
  input: PersistOrderSnapshotInput,
): Promise<OrderRow> {
  const [row] = await transaction
    .insert(customerOrder)
    .values({
      id: input.id,
      reference: input.reference,
      customerId:
        input.owner.kind === "customer" ? input.owner.customerId : null,
      guestCartHash:
        input.owner.kind === "guest" ? input.owner.guestCartHash : null,
      guestAccessTokenHash: input.guestCredential
        ? sha256(input.guestCredential)
        : null,
      guestAccessExpiresAt: input.guestCredential
        ? sql`now() + interval '30 days'`
        : null,
      sourceDraftId: input.sourceDraftId ?? null,
      createdByStaffId: input.createdByStaffId ?? null,
      quoteId: input.quote.id,
      cartRevision: input.cartRevision,
      reservationId: input.reservationId,
      addressSnapshot: input.addressSnapshot,
      status: input.status,
      paymentMethod: "cod",
      collectionStatus: "uncollected",
      fulfillmentStatus: input.fulfillmentStatus,
      merchandiseGrossBdt: input.quote.merchandiseGrossBdt,
      deliveryAmountBdt: input.quote.delivery.grossAmountBdt,
      totalBdt: input.quote.totalBdt,
      codAmountDueBdt: input.quote.totalBdt,
      deliverySnapshot: {
        tariffVersion: input.quote.delivery.tariffVersion,
        effectiveFrom: input.quote.delivery.effectiveFrom,
        zone: input.quote.delivery.zone,
        geographyVersion: input.quote.destination.geographyVersion,
        divisionId: input.quote.destination.divisionId,
        districtId: input.quote.destination.districtId,
        upazilaId: input.quote.destination.upazilaId,
      },
    })
    .returning();
  if (!row) throw new Error("Order insert returned no row.");

  await transaction.insert(customerOrderLine).values(
    input.quote.lines.map((line) => ({
      orderId: input.id,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceBdt: line.unitPriceBdt,
      grossAmountBdt: line.grossAmountBdt,
      productSnapshot: {
        productName: line.productName,
        color: line.color,
        sizeLabel: line.sizeLabel,
        compareAtPriceBdt: line.compareAtPriceBdt,
      },
    })),
  );
  return row;
}

function availableOrderStatusActions(
  row: Pick<OrderRow, "status" | "fulfillmentStatus" | "cancellationReason">,
  hasPathaoClaim: boolean,
): OrderStatusAction[] {
  const pending =
    (row.status === "pending" || row.status === "no_answer") &&
    row.fulfillmentStatus === "not_started";
  const held =
    row.status === "on_hold" &&
    (row.fulfillmentStatus === "not_started" ||
      row.fulfillmentStatus === "awaiting_dispatch");
  const confirmed =
    row.status === "confirmed" && row.fulfillmentStatus === "awaiting_dispatch";
  const cancelled =
    row.status === "cancelled" &&
    row.fulfillmentStatus === "cancelled" &&
    row.cancellationReason !== null;
  const actions: OrderStatusAction[] = [];

  if (!hasPathaoClaim && (confirmed || cancelled)) actions.push("pending");
  if (pending || held) actions.push("confirmed");
  if (pending && row.status === "pending") {
    actions.push("no_answer");
  }
  if (!hasPathaoClaim && (pending || confirmed)) actions.push("on_hold");
  if (!hasPathaoClaim && (pending || held || confirmed)) {
    actions.push("cancelled");
  }
  return actions;
}

function canEditOrderPricing(
  row: OrderItemMutationRow,
  hasPathaoClaim: boolean,
): boolean {
  const pendingManualReview =
    row.status === "pending" && row.fulfillmentStatus === "not_started";
  const confirmedAndAwaitingDispatch =
    row.status === "confirmed" && row.fulfillmentStatus === "awaiting_dispatch";

  return (
    !hasPathaoClaim &&
    row.collectionStatus === "uncollected" &&
    row.collectedAmountBdt === null &&
    (pendingManualReview || confirmedAndAwaitingDispatch)
  );
}

@Injectable()
export class OrdersService implements OrdersPathaoPort {
  constructor(
    private readonly database: DatabaseService,
    private readonly cart: CartService,
    private readonly quotes: QuoteService,
    private readonly geography: GeographyService,
    private readonly audit: AuditService,
    @Inject(CATALOG_CART_PORT)
    private readonly catalog: CatalogCartPort,
    @Inject(INVENTORY_RESERVATION_PORT)
    private readonly inventory: InventoryReservationPort,
    private readonly drafts: CheckoutDraftsService,
  ) {}

  async previewDraftOrder(id: string, input: CheckoutDraftPreviewInput) {
    const draft = await this.drafts.getEligible(id);
    if (
      draft.version !== input.expectedVersion ||
      draft.outcome !== "interested"
    ) {
      throw new ConflictException(
        "The draft changed or has not been marked interested.",
        { errorCode: "DRAFT_STALE" },
      );
    }
    const address = normalizeCheckoutInput(input.address);
    const items = readDraftItems(draft);
    const priced = await this.quotes.previewAssisted(items, address);
    const fingerprint = fingerprintDraftPreview(
      id,
      draft.version,
      address,
      priced,
    );
    return CheckoutDraftPreviewSchema.parse({
      draftVersion: draft.version,
      lines: priced.lines.map((line) => ({
        variantId: line.variantId,
        productName: line.productName,
        color: line.color,
        sizeLabel: line.sizeLabel,
        quantity: line.quantity,
        unitPriceBdt: line.unitPriceBdt,
        grossAmountBdt: line.grossAmountBdt,
      })),
      merchandiseGrossBdt: priced.merchandiseGrossBdt,
      deliveryAmountBdt: priced.tariff.feeBdt,
      totalBdt: priced.totalBdt,
      fingerprint,
    });
  }

  async createFromDraft(
    id: string,
    staffId: string,
    input: CheckoutDraftCreateOrderInput,
  ): Promise<OrderCreated> {
    const [prior] = await this.database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.sourceDraftId, id))
      .limit(1);
    if (prior) return toCreated(prior, true);
    const draft = await this.drafts.getEligible(id);
    const owner = draftOwner(draft);
    const normalizedInput = normalizeCheckoutInput(input.address);
    const orderId = randomUUID();
    let saved: OrderRow;
    try {
      saved = await this.database.db.transaction(async (tx) => {
        await lockCartOwner(
          tx,
          owner.kind,
          owner.kind === "customer" ? owner.customerId : owner.guestCartHash,
        );
        const [current] = await tx
          .select()
          .from(checkoutDraft)
          .where(eq(checkoutDraft.id, id))
          .for("update")
          .limit(1);
        if (
          !current ||
          current.version !== input.expectedVersion ||
          current.outcome !== "interested" ||
          !this.drafts.isOldEnough(current)
        ) {
          throw new ConflictException("The draft changed. Preview it again.", {
            errorCode: "DRAFT_STALE",
          });
        }
        const selections = readDraftItems(current);
        const guestCartId = readDraftGuestCartId(current);
        const cartContext = await this.cart.getQuoteContext(
          owner.kind === "customer" ? owner.customerId : undefined,
          guestCartId,
        );
        if (
          cartContext.cart.lines.length > 0 &&
          (cartContext.cart.revision !== current.cartRevision ||
            cartContext.cart.lines.length !== selections.length ||
            selections.some(
              (line, index) =>
                line.variantId !== cartContext.cart.lines[index]?.variantId ||
                line.quantity !== cartContext.cart.lines[index]?.quantity,
            ))
        ) {
          throw new ConflictException(
            "The cart changed. Review the checkout again.",
            { errorCode: "DRAFT_CART_CHANGED" },
          );
        }
        if (owner.kind === "customer" && cartContext.cart.lines.length === 0) {
          throw new ConflictException(
            "The customer cart is no longer available.",
            { errorCode: "DRAFT_CART_CHANGED" },
          );
        }
        if (owner.kind === "guest") {
          await this.cart.claimGuestDraftRevisionForCheckout(
            tx,
            guestCartId,
            owner.guestCartHash,
            current.cartRevision,
          );
        }
        const quote = await this.quotes.createAssistedWithinTransaction(
          tx,
          owner,
          current.cartRevision,
          selections,
          normalizedInput,
        );
        const address = this.resolveAddress(normalizedInput, quote.destination);
        const priced = {
          lines: quote.lines,
          merchandiseGrossBdt: quote.merchandiseGrossBdt,
          tariff: {
            feeBdt: quote.delivery.grossAmountBdt,
            version: quote.delivery.tariffVersion,
            effectiveFrom: quote.delivery.effectiveFrom,
            zone: quote.delivery.zone,
          },
          totalBdt: quote.totalBdt,
        };
        if (
          quote.totalBdt !== input.acceptedTotalBdt ||
          fingerprintDraftPreview(
            id,
            current.version,
            normalizedInput,
            priced,
          ) !== input.previewFingerprint
        ) {
          throw new ConflictException(
            "The current price or delivery details changed. Confirm the new total with the customer.",
            { errorCode: "DRAFT_PREVIEW_CHANGED" },
          );
        }
        const [counter] = await tx
          .insert(orderReferenceCounter)
          .values({
            year: sql<number>`extract(year from now() at time zone 'Asia/Dhaka')::integer`,
            lastNumber: 1,
          })
          .onConflictDoUpdate({
            target: orderReferenceCounter.year,
            set: { lastNumber: sql`${orderReferenceCounter.lastNumber} + 1` },
          })
          .returning({
            year: orderReferenceCounter.year,
            number: orderReferenceCounter.lastNumber,
          });
        if (!counter) throw new Error("Order reference allocation failed.");
        const reservation = await this.inventory.reserveWithinTransaction(tx, {
          commandId: orderId,
          lines: quote.lines.map(({ variantId, quantity }) => ({
            variantId,
            quantity,
          })),
        });
        const row = await persistOrderSnapshot(tx, {
          id: orderId,
          reference: formatOrderReference(counter.year, counter.number),
          owner,
          quote,
          cartRevision: current.cartRevision,
          reservationId: reservation.id,
          addressSnapshot: address,
          status: "confirmed",
          fulfillmentStatus: "awaiting_dispatch",
          sourceDraftId: id,
          createdByStaffId: staffId,
        });
        if (owner.kind === "customer") {
          const cleared = await this.cart.clearCustomerCartForCheckout(
            tx,
            owner.customerId,
            current.cartRevision,
          );
          if (!cleared)
            throw new ConflictException("The customer cart changed.", {
              errorCode: "DRAFT_CART_CHANGED",
            });
        }
        await tx.delete(checkoutDraft).where(eq(checkoutDraft.id, id));
        await this.audit.append(tx, {
          actorType: "user",
          actorId: staffId,
          eventType: "commerce.cod_order_created",
          subjectType: "order",
          subjectId: orderId,
          metadata: {
            sourceDraftId: id,
            totalBdt: quote.totalBdt,
            reservationId: reservation.id,
          },
        });
        await this.audit.append(tx, {
          actorType: "user",
          actorId: staffId,
          eventType: "commerce.cod_order_confirmed",
          subjectType: "order",
          subjectId: orderId,
          metadata: { sourceDraftId: id, status: "confirmed" },
        });
        return row;
      });
    } catch (error) {
      const [existing] = await this.database.db
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.sourceDraftId, id))
        .limit(1);
      if (existing) return toCreated(existing, true);
      throw error;
    }
    if (owner.kind === "guest") {
      await this.cart.clearGuestCartAfterCheckout(
        readDraftGuestCartId(draft),
        draft.cartRevision,
      );
    }
    return toCreated(saved, false);
  }

  async create(
    customerId: string | undefined,
    guestCartId: string | undefined,
    input: CreateOrderInput,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
  ): Promise<{ order: OrderCreated; guestCredential: string | null }> {
    const owner = this.cart.identifyQuoteOwner(customerId, guestCartId);
    if (!owner) throw orderNotFound();
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
      return this.resolveReplay(
        replay.order,
        replay.guestAccessStillValid,
        owner,
        idempotencyKey,
        signedCookies,
        guestCartId,
      );
    }

    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner) throw orderNotFound();

    if (context.cart.lines.length === 0) {
      throw new ConflictException("The cart is empty or no longer available.", {
        errorCode: "ORDER_CART_UNAVAILABLE",
      });
    }

    const quote = await this.quotes.getCurrentForCheckout(
      customerId,
      guestCartId,
      input.quoteId,
      context,
    );
    if (!sameDestination(quote, input.address)) {
      await this.geography.resolveStoredDestination({
        geographyVersion: input.address.geographyVersion,
        divisionId: input.address.divisionId,
        districtId: input.address.districtId,
        ...(input.address.upazilaId
          ? { upazilaId: input.address.upazilaId }
          : {}),
      });
      throw new ConflictException(
        "The cart or delivery destination changed. Request a fresh quote.",
        { errorCode: "QUOTE_STALE" },
      );
    }
    if (
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
    const address = this.resolveAddress(input.address, quote.destination);

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
    let saved: OrderCreatedRow;
    let replayed = false;
    try {
      saved = await this.database.db.transaction(async (transaction) => {
        await lockOrderIdempotency(transaction, ownerHash, keyHash);
        const [prior] = await transaction
          .select({
            order: {
              id: customerOrder.id,
              reference: customerOrder.reference,
              totalBdt: customerOrder.totalBdt,
              codAmountDueBdt: customerOrder.codAmountDueBdt,
              status: customerOrder.status,
              paymentMethod: customerOrder.paymentMethod,
              collectionStatus: customerOrder.collectionStatus,
              fulfillmentStatus: customerOrder.fulfillmentStatus,
              createdAt: customerOrder.createdAt,
              guestAccessExpiresAt: customerOrder.guestAccessExpiresAt,
              cartRevision: customerOrder.cartRevision,
            },
            requestFingerprint: orderIdempotency.requestFingerprint,
          })
          .from(orderIdempotency)
          .innerJoin(
            customerOrder,
            eq(customerOrder.id, orderIdempotency.orderId),
          )
          .where(
            and(
              eq(orderIdempotency.ownerHash, ownerHash),
              eq(orderIdempotency.keyHash, keyHash),
            ),
          )
          .limit(1);
        if (prior) {
          assertIdempotencyFingerprint(prior, requestFingerprint);
          replayed = true;
          return prior.order;
        }

        await this.quotes.lockAndValidateForOrderCheckout(
          transaction,
          quote,
          owner,
        );

        if (owner.kind === "guest") {
          const [consumedCartRevision] = await transaction
            .select({ id: customerOrder.id })
            .from(customerOrder)
            .where(
              guestCartRevisionCondition(
                owner.guestCartHash,
                quote.cartRevision,
              ),
            )
            .limit(1);
          if (consumedCartRevision) {
            throw new ConflictException(
              "This guest cart was already checked out. Refresh the cart before starting another checkout.",
              { errorCode: "ORDER_CART_ALREADY_CHECKED_OUT" },
            );
          }
          await this.cart.claimGuestCartRevisionForCheckout(
            transaction,
            guestCartId,
            owner.guestCartHash,
            quote.cartRevision,
          );
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
            setWhere: sql`${orderReferenceCounter.lastNumber} < 99999`,
          })
          .returning({
            year: orderReferenceCounter.year,
            number: orderReferenceCounter.lastNumber,
          });
        if (!counter) {
          throw new ServiceUnavailableException(
            "This year’s Order reference limit has been reached.",
            { errorCode: "ORDER_REFERENCE_CAPACITY_REACHED" },
          );
        }
        const reference = formatOrderReference(counter.year, counter.number);

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
            addressSnapshot: address,
            status: "pending",
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
          .returning({
            id: customerOrder.id,
            reference: customerOrder.reference,
            totalBdt: customerOrder.totalBdt,
            codAmountDueBdt: customerOrder.codAmountDueBdt,
            status: customerOrder.status,
            paymentMethod: customerOrder.paymentMethod,
            collectionStatus: customerOrder.collectionStatus,
            fulfillmentStatus: customerOrder.fulfillmentStatus,
            createdAt: customerOrder.createdAt,
            guestAccessExpiresAt: customerOrder.guestAccessExpiresAt,
            cartRevision: customerOrder.cartRevision,
          });
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
              compareAtPriceBdt: line.compareAtPriceBdt,
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

        await transaction
          .delete(checkoutDraft)
          .where(eq(checkoutDraft.ownerHash, ownerHash));

        return row;
      });
    } catch (error) {
      if (isGuestCartAlreadyCheckedOut(error) && owner.kind === "guest") {
        const [priorOrder] = await this.database.db
          .select({ cartRevision: customerOrder.cartRevision })
          .from(customerOrder)
          .where(
            guestCartRevisionCondition(owner.guestCartHash, quote.cartRevision),
          )
          .limit(1);
        if (priorOrder) {
          await this.cleanupGuestCartAfterCheckout(
            priorOrder,
            owner,
            guestCartId,
          );
        }
      }
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotencyReplay(
          ownerHash,
          keyHash,
          requestFingerprint,
        );
        if (existing) {
          return this.resolveReplay(
            existing.order,
            existing.guestAccessStillValid,
            owner,
            idempotencyKey,
            signedCookies,
            guestCartId,
          );
        }
        throw new ConflictException(
          "This quote has already been used or checkout changed. Request a fresh quote.",
          { errorCode: "ORDER_CHECKOUT_CONFLICT" },
        );
      }
      throw error;
    }

    await this.cleanupGuestCartAfterCheckout(saved, owner, guestCartId);
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
    const owner = this.cart.identifyQuoteOwner(customerId, guestCartId);
    if (owner?.kind !== "guest") throw orderNotFound();
    const ownerHash = hashOwner(owner);
    const keyHash = sha256(idempotencyKey);
    const attemptCookieName = guestOrderAttemptCookieName(idempotencyKey);
    const currentAttempt = signedCookies[attemptCookieName];
    const [prior] = await this.database.db
      .select({
        order: {
          id: customerOrder.id,
          guestAccessTokenHash: customerOrder.guestAccessTokenHash,
          guestAccessExpiresAt: customerOrder.guestAccessExpiresAt,
          cartRevision: customerOrder.cartRevision,
        },
        guestAccessStillValid: sql<boolean>`coalesce(${customerOrder.guestAccessExpiresAt} > now(), false)`,
      })
      .from(orderIdempotency)
      .innerJoin(customerOrder, eq(customerOrder.id, orderIdempotency.orderId))
      .where(
        and(
          eq(orderIdempotency.ownerHash, ownerHash),
          eq(orderIdempotency.keyHash, keyHash),
        ),
      )
      .limit(1);
    if (prior) {
      const row = prior.order;
      if (
        isGuestAttemptCredential(currentAttempt, idempotencyKey) &&
        (await this.matchesGuestCredential(
          row,
          currentAttempt,
          prior.guestAccessStillValid,
        ))
      ) {
        await this.cleanupGuestCartAfterCheckout(row, owner, guestCartId);
        return currentAttempt;
      }
      const orderCookie = signedCookies[guestOrderCookieName(row.id)];
      if (
        await this.matchesGuestCredential(
          row,
          orderCookie,
          prior.guestAccessStillValid,
        )
      ) {
        await this.cleanupGuestCartAfterCheckout(row, owner, guestCartId);
        return null;
      }
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
    const owner = this.cart.identifyQuoteOwner(customerId, guestCartId);
    if (!owner) throw orderNotFound();
    const replay = await this.findIdempotencyReplay(
      hashOwner(owner),
      sha256(idempotencyKey),
      undefined,
    );
    if (!replay) {
      throw new NotFoundException("No completed checkout was found.", {
        errorCode: "CHECKOUT_NOT_FOUND",
      });
    }
    return this.resolveReplay(
      replay.order,
      replay.guestAccessStillValid,
      owner,
      idempotencyKey,
      signedCookies,
      guestCartId,
    );
  }

  private async resolveReplay(
    row: CheckoutReplayOrder,
    guestAccessStillValid: boolean,
    owner: CartQuoteOwner,
    idempotencyKey: string,
    signedCookies: Record<string, string>,
    guestCartId: string | undefined,
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
      (await this.matchesGuestCredential(row, attempt, guestAccessStillValid))
    ) {
      await this.cleanupGuestCartAfterCheckout(row, owner, guestCartId);
      return { order: toCreated(row, true), guestCredential: attempt };
    }
    const existingOrderCookie = signedCookies[guestOrderCookieName(row.id)];
    if (
      await this.matchesGuestCredential(
        row,
        existingOrderCookie,
        guestAccessStillValid,
      )
    ) {
      await this.cleanupGuestCartAfterCheckout(row, owner, guestCartId);
      return { order: toCreated(row, true), guestCredential: null };
    }
    throw orderAccessUnavailable();
  }

  private async cleanupGuestCartAfterCheckout(
    row: Pick<OrderRow, "cartRevision">,
    owner: CartQuoteOwner,
    guestCartId: string | undefined,
  ): Promise<void> {
    if (owner.kind !== "guest") return;
    const result = await this.cart.clearGuestCartAfterCheckout(
      guestCartId,
      row.cartRevision,
    );
    if (result === "unavailable") {
      throw new ServiceUnavailableException(
        "The Order was created, but cart cleanup is pending. Retry checkout to resume safely.",
        { errorCode: "ORDER_CART_CLEANUP_PENDING" },
      );
    }
  }

  private async matchesGuestCredential(
    row: Pick<OrderRow, "guestAccessTokenHash" | "guestAccessExpiresAt">,
    candidate: string | undefined,
    guestAccessStillValid: boolean,
  ): Promise<boolean> {
    if (
      !row.guestAccessTokenHash ||
      !row.guestAccessExpiresAt ||
      !guestAccessStillValid ||
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
    return true;
  }

  async getForOwner(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<Order> {
    const [result] = await this.database.db
      .select({
        order: customerOrder,
        guestAccessStillValid: sql<boolean>`coalesce(${customerOrder.guestAccessExpiresAt} > now(), false)`,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!result) throw orderNotFound();
    const row = result.order;

    const authorizedCustomer =
      customerId !== undefined && row.customerId === customerId;
    const authorizedGuest =
      row.customerId === null &&
      (await this.hasValidGuestCredential(
        row,
        signedCookies,
        result.guestAccessStillValid,
      ));
    if (!authorizedCustomer && !authorizedGuest) throw orderNotFound();
    return this.loadPrivateOrder(row);
  }

  async listForManagement(
    query: OrderListQuery,
  ): Promise<ReturnType<typeof OrderManagementListSchema.parse>> {
    const exactOrderSearch = query.search
      ? parseExactOrderSearch(query.search)
      : null;
    const referencePrefixSearch = query.search
      ? query.search.toUpperCase().startsWith("ORD-") ||
        query.search.toUpperCase().startsWith("AA-")
      : false;
    const listFilters = managedOrderFilters(query);
    const oldestFirst = shouldPrioritizeHeldOrders(query);
    let rows: ManagedOrderListRecord[];
    if (query.search && !exactOrderSearch && !referencePrefixSearch) {
      rows = await this.searchManagedOrdersByCustomer(query, query.search);
    } else {
      const referenceSearch = query.search?.toUpperCase();
      rows = await this.database.db
        .select(MANAGED_ORDER_LIST_SELECTION)
        .from(customerOrder)
        .where(
          and(
            ...listFilters,
            exactOrderSearch
              ? exactOrderSearch.kind === "reference"
                ? eq(customerOrder.reference, exactOrderSearch.value)
                : eq(customerOrder.id, exactOrderSearch.value)
              : referencePrefixSearch && referenceSearch
                ? like(
                    customerOrder.reference,
                    `${escapeLikeWildcards(referenceSearch)}%`,
                  )
                : undefined,
          ),
        )
        .orderBy(
          oldestFirst
            ? asc(customerOrder.createdAt)
            : desc(customerOrder.createdAt),
          oldestFirst ? asc(customerOrder.id) : desc(customerOrder.id),
        )
        .limit(query.limit + 1)
        .offset(query.offset);
    }
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
    return OrderManagementListSchema.parse({
      rows: pageRows.map((row) => {
        const address = parseStoredOrderAddress(row.addressSnapshot);
        return {
          id: row.id,
          reference: row.reference,
          customerName: address.recipientName,
          customerPhone: address.phone,
          deliveryZone: parseDeliveryZone(row.deliverySnapshot),
          items: (linesByOrderId.get(row.id) ?? []).map((line) => {
            const product = parseOrderLineProduct(line.productSnapshot);
            return {
              productName: product.productName,
              color: product.color,
              sizeLabel: product.sizeLabel,
              quantity: line.quantity,
            };
          }),
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

  async listCustomerDirectory(
    query: CustomerDirectoryQuery,
  ): Promise<ReturnType<typeof ManagedCustomerDirectorySchema.parse>> {
    const records = query.search
      ? await this.searchCustomerDirectory(query)
      : await this.selectCustomerDirectoryPage(query.limit + 1, query.offset);
    const pageRecords = records.slice(0, query.limit);
    const hasMore = records.length > query.limit;
    const countedPageRecords =
      await this.attachCustomerOrderCounts(pageRecords);
    return ManagedCustomerDirectorySchema.parse({
      rows: countedPageRecords.map((row) => {
        const address = parseStoredOrderAddress(row.address_snapshot);
        const accountName = row.account_name?.trim();
        return {
          id: row.customer_key,
          identityType: row.identity_type,
          name:
            row.identity_type === "account" &&
            accountName &&
            accountName.length >= 2
              ? accountName
              : address.recipientName,
          email: row.account_email,
          latestRecipientName: address.recipientName,
          latestRecipientPhone: address.phone,
          orderCount: Number(row.order_count),
          lastOrderAt: new Date(row.last_order_at).toISOString(),
          latestOrder: {
            id: row.latest_order_id,
            reference: row.latest_order_reference,
            status: row.latest_order_status,
            createdAt: new Date(row.last_order_at).toISOString(),
          },
        };
      }),
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset:
        hasMore && query.offset + query.limit <= MAX_LIST_OFFSET
          ? query.offset + query.limit
          : null,
    });
  }

  async listCustomerOrders(
    customerKey: string,
    query: CustomerOrdersQuery,
  ): Promise<ReturnType<typeof ManagedCustomerOrdersPageSchema.parse>> {
    const parsedKey = CustomerDirectoryIdSchema.safeParse(customerKey);
    if (!parsedKey.success) throw orderNotFound();

    const accountId = /^account_(.+)$/.exec(parsedKey.data)?.[1];
    const guestOrderId = /^guest_(.+)$/.exec(parsedKey.data)?.[1];
    const customerFilter = accountId
      ? eq(customerOrder.customerId, accountId)
      : and(
          eq(customerOrder.id, guestOrderId!),
          sql`${customerOrder.customerId} is null`,
        );
    const rows = await this.database.db
      .select({
        id: customerOrder.id,
        reference: customerOrder.reference,
        status: customerOrder.status,
        fulfillmentStatus: customerOrder.fulfillmentStatus,
        totalBdt: customerOrder.totalBdt,
        createdAt: customerOrder.createdAt,
      })
      .from(customerOrder)
      .where(customerFilter)
      .orderBy(desc(customerOrder.createdAt), desc(customerOrder.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    if (rows.length === 0 && query.offset === 0) throw orderNotFound();

    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return ManagedCustomerOrdersPageSchema.parse({
      rows: pageRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      limit: query.limit,
      offset: query.offset,
      hasMore,
      nextOffset:
        hasMore && query.offset + query.limit <= MAX_LIST_OFFSET
          ? query.offset + query.limit
          : null,
    });
  }

  private async searchCustomerDirectory(
    query: CustomerDirectoryQuery,
  ): Promise<CustomerDirectoryRecord[]> {
    const search = query.search ?? "";
    const textSearch = normalizeOrderSearchText(search);
    const phoneSearch = normalizeOrderPhoneDigits(search);
    const phoneOnly = phoneSearch.length > 0 && !/[a-z]/i.test(search);
    if (phoneOnly && phoneSearch.length < 4) return [];

    const textPrefix = escapeLikeWildcards(textSearch) + "%";
    const phonePrefix =
      escapeLikeWildcards(toCanonicalBangladeshPhonePrefix(phoneSearch)) + "%";
    const exactSearch = parseExactOrderSearch(search);
    const exactReference =
      exactSearch?.kind === "reference" ? exactSearch.value : null;
    const exactOrderId = exactSearch?.kind === "id" ? exactSearch.value : null;
    const accountMatch = phoneOnly
      ? sql`false`
      : sql`lower(account.name) like ${textPrefix}
          or lower(account.email) like ${textPrefix}`;
    const orderMatch = phoneOnly
      ? sql`regexp_replace(order_row.address_snapshot->>'phone', '[^0-9]', '', 'g')
          like ${phonePrefix}`
      : sql`lower(order_row.address_snapshot->>'recipientName') like ${textPrefix}
          or order_row.reference = ${exactReference}
          or order_row.id::text = ${exactOrderId}`;
    const guestOrderMatch = phoneOnly
      ? sql`regexp_replace(guest.address_snapshot->>'phone', '[^0-9]', '', 'g')
          like ${phonePrefix}`
      : sql`lower(guest.address_snapshot->>'recipientName') like ${textPrefix}
          or guest.reference = ${exactReference}
          or guest.id::text = ${exactOrderId}`;

    const result = await this.database.db.execute(sql`
      with matching_order_customers as materialized (
        select distinct order_row.customer_id
        from orders.order_header order_row
        where order_row.customer_id is not null
          and (${orderMatch})
      ), candidate_accounts as (
        select account.id as customer_id
        from identity.user account
        where (${accountMatch})
        union
        select matching_order_customers.customer_id
        from matching_order_customers
      ), customer_rows as (
        select
          'account_' || account.id as customer_key,
          'account'::text as identity_type,
          account.name as account_name,
          account.email as account_email,
          1::bigint as order_count,
          latest.created_at as last_order_at,
          latest.id as latest_order_id,
          latest.reference as latest_order_reference,
          latest.status as latest_order_status,
          latest.address_snapshot
        from candidate_accounts candidate
        join identity.user account on account.id = candidate.customer_id
        join lateral (
          select order_row.id, order_row.reference, order_row.status,
                 order_row.address_snapshot, order_row.created_at
          from orders.order_header order_row
          where order_row.customer_id = candidate.customer_id
          order by order_row.created_at desc, order_row.id desc
          limit 1
        ) latest on true
        union all
        select
          'guest_' || guest.id as customer_key,
          'guest_order'::text as identity_type,
          null::text as account_name,
          null::text as account_email,
          1::bigint as order_count,
          guest.created_at as last_order_at,
          guest.id as latest_order_id,
          guest.reference as latest_order_reference,
          guest.status as latest_order_status,
          guest.address_snapshot
        from orders.order_header guest
        where guest.customer_id is null
          and (${guestOrderMatch})
      )
      select
        customer_rows.customer_key,
        customer_rows.identity_type,
        customer_rows.account_name,
        customer_rows.account_email,
        customer_rows.order_count,
        customer_rows.last_order_at,
        customer_rows.latest_order_id,
        customer_rows.latest_order_reference,
        customer_rows.latest_order_status,
        customer_rows.address_snapshot
      from customer_rows
      order by customer_rows.last_order_at desc, customer_rows.latest_order_id desc
      limit ${query.limit + 1}
      offset ${query.offset}
    `);
    return result.rows as CustomerDirectoryRecord[];
  }

  private async selectCustomerDirectoryPage(
    limit: number,
    offset: number,
  ): Promise<CustomerDirectoryRecord[]> {
    const result = await this.database.db.execute(sql`
      with latest_account_orders as (
        select distinct on (customer_id)
          customer_id, id, reference, status, address_snapshot, created_at
        from orders.order_header
        where customer_id is not null
        order by customer_id, created_at desc, id desc
      ), customer_rows as (
        select
          'account_' || account.id as customer_key,
          'account'::text as identity_type,
          account.name as account_name,
          account.email as account_email,
          1::bigint as order_count,
          latest.created_at as last_order_at,
          latest.id as latest_order_id,
          latest.reference as latest_order_reference,
          latest.status as latest_order_status,
          latest.address_snapshot
        from latest_account_orders latest
        join identity.user account on account.id = latest.customer_id
        union all
        select
          'guest_' || guest.id as customer_key,
          'guest_order'::text as identity_type,
          null::text as account_name,
          null::text as account_email,
          1::bigint as order_count,
          guest.created_at as last_order_at,
          guest.id as latest_order_id,
          guest.reference as latest_order_reference,
          guest.status as latest_order_status,
          guest.address_snapshot
        from orders.order_header guest
        where guest.customer_id is null
      )
      select
        customer_rows.customer_key,
        customer_rows.identity_type,
        customer_rows.account_name,
        customer_rows.account_email,
        customer_rows.order_count,
        customer_rows.last_order_at,
        customer_rows.latest_order_id,
        customer_rows.latest_order_reference,
        customer_rows.latest_order_status,
        customer_rows.address_snapshot
      from customer_rows
      order by customer_rows.last_order_at desc, customer_rows.latest_order_id desc
      limit ${limit}
      offset ${offset}
    `);
    return result.rows as CustomerDirectoryRecord[];
  }

  private async attachCustomerOrderCounts(
    records: CustomerDirectoryRecord[],
  ): Promise<CustomerDirectoryRecord[]> {
    const accountIds = records
      .filter((record) => record.identity_type === "account")
      .map((record) => record.customer_key.slice("account_".length));
    if (accountIds.length === 0) return records;

    const counts = await this.database.db
      .select({ customerId: customerOrder.customerId, orderCount: count() })
      .from(customerOrder)
      .where(inArray(customerOrder.customerId, accountIds))
      .groupBy(customerOrder.customerId);
    const countByAccountId = new Map(
      counts.map((row) => [row.customerId, row.orderCount]),
    );
    return records.map((record) =>
      record.identity_type === "account"
        ? {
            ...record,
            order_count:
              countByAccountId.get(
                record.customer_key.slice("account_".length),
              ) ?? 0,
          }
        : record,
    );
  }

  private async searchManagedOrdersByCustomer(
    query: OrderListQuery,
    search: string,
  ): Promise<ManagedOrderListRecord[]> {
    const nameSearch = normalizeOrderSearchText(search);
    const phoneSearch = normalizeOrderPhoneDigits(search);
    const isPhoneSearch = /^[+\d০-৯().\s-]+$/u.test(search);
    const filters = managedOrderFilters(query);
    const oldestFirst = shouldPrioritizeHeldOrders(query);
    const orderBy = oldestFirst
      ? [asc(customerOrder.createdAt), asc(customerOrder.id)]
      : [desc(customerOrder.createdAt), desc(customerOrder.id)];
    const customerSearch = isPhoneSearch
      ? phoneSearch.length === 0
        ? sql`false`
        : like(
            sql`regexp_replace(${customerOrder.addressSnapshot}->>'phone', '[^0-9]', '', 'g')`,
            `${escapeLikeWildcards(toCanonicalBangladeshPhonePrefix(phoneSearch))}%`,
          )
      : like(
          sql`lower(${customerOrder.addressSnapshot}->>'recipientName')`,
          `${escapeLikeWildcards(nameSearch)}%`,
        );

    return this.database.db
      .select(MANAGED_ORDER_LIST_SELECTION)
      .from(customerOrder)
      .where(and(...filters, customerSearch))
      .orderBy(...orderBy)
      .limit(query.limit + 1)
      .offset(query.offset);
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

  async getManagementDetail(orderId: string): Promise<OrderManagementDetail> {
    const [result] = await this.database.db
      .select({
        order: customerOrder,
        pathaoClaimStatus: orderPathaoBookingClaim.status,
      })
      .from(customerOrder)
      .leftJoin(
        orderPathaoBookingClaim,
        eq(orderPathaoBookingClaim.orderId, customerOrder.id),
      )
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!result?.order) throw orderNotFound();

    const row = result.order;
    const order = await this.loadPrivateOrder(row);
    const canEditPricing = canEditOrderPricing(
      row,
      result.pathaoClaimStatus !== null,
    );
    return OrderManagementDetailSchema.parse({
      ...order,
      availableStatusActions: availableOrderStatusActions(
        row,
        result.pathaoClaimStatus !== null,
      ),
      canEditItems: canEditPricing,
      canEditDiscount: canEditPricing,
    });
  }

  async addCatalogItem(
    orderId: string,
    staffId: string,
    input: OrderItemAddInput,
  ): Promise<OrderManagementDetail> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          collectionStatus: customerOrder.collectionStatus,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
          merchandiseGrossBdt: customerOrder.merchandiseGrossBdt,
          manualDiscountBdt: customerOrder.manualDiscountBdt,
          deliveryAmountBdt: customerOrder.deliveryAmountBdt,
          reservationId: customerOrder.reservationId,
          totalBdt: customerOrder.totalBdt,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();

      const lines = await transaction
        .select({
          id: customerOrderLine.id,
          variantId: customerOrderLine.variantId,
          quantity: customerOrderLine.quantity,
          unitPriceBdt: customerOrderLine.unitPriceBdt,
          grossAmountBdt: customerOrderLine.grossAmountBdt,
        })
        .from(customerOrderLine)
        .where(eq(customerOrderLine.orderId, row.id))
        .orderBy(asc(customerOrderLine.variantId));
      const existingLine = lines.find(
        ({ variantId }) => variantId === input.variantId,
      );
      if ((existingLine?.quantity ?? 0) !== input.expectedQuantity) {
        throw new ConflictException(
          "The item quantity changed. Refresh the Order before trying again.",
          { errorCode: "ORDER_ITEM_QUANTITY_CHANGED" },
        );
      }
      if (
        existingLine &&
        existingLine.quantity + input.quantity > MAX_CART_QUANTITY_PER_VARIANT
      ) {
        throw new ConflictException(
          `The quantity for this variant cannot exceed ${MAX_CART_QUANTITY_PER_VARIANT}.`,
          { errorCode: "ORDER_ITEM_QUANTITY_LIMIT_REACHED" },
        );
      }
      if (!existingLine && lines.length >= MAX_ORDER_LINES) {
        throw new ConflictException("This Order has reached its item limit.", {
          errorCode: "ORDER_ITEM_LIMIT_REACHED",
        });
      }

      const [pathaoClaim] = await transaction
        .select({ orderId: orderPathaoBookingClaim.orderId })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .for("update")
        .limit(1);
      if (pathaoClaim) {
        throw new ConflictException(
          "Items cannot be changed while a Pathao consignment exists for this Order.",
          { errorCode: "ORDER_PATHAO_BOOKING_BLOCKS_ITEM_EDIT" },
        );
      }
      if (!canEditOrderPricing(row, false)) {
        throw new ConflictException(
          "Only pending or confirmed, unbooked Orders with an uncollected COD amount can have items added.",
          { errorCode: "ORDER_ITEMS_NOT_EDITABLE" },
        );
      }

      const [variant] =
        await this.catalog.findPurchasableVariantsWithinTransaction(
          transaction,
          [input.variantId],
        );
      if (!variant) {
        throw new UnprocessableEntityException(
          "This product variant is no longer available for sale.",
          { errorCode: "ORDER_ITEM_VARIANT_UNAVAILABLE" },
        );
      }
      const unitPriceBdt = existingLine?.unitPriceBdt ?? variant.unitPriceBdt;
      if (unitPriceBdt !== input.expectedUnitPriceBdt) {
        throw new ConflictException(
          existingLine
            ? "The saved Order price changed. Refresh the Order before trying again."
            : "The product price changed. Confirm the updated price with the customer before adding it.",
          { errorCode: "ORDER_ITEM_PRICE_CHANGED" },
        );
      }

      const currentMerchandiseBdt = lines.reduce(
        (total, line) => total + line.grossAmountBdt,
        0,
      );
      if (
        currentMerchandiseBdt !== row.merchandiseGrossBdt ||
        row.totalBdt !==
          row.merchandiseGrossBdt +
            row.deliveryAmountBdt -
            row.manualDiscountBdt ||
        row.codAmountDueBdt !== row.totalBdt ||
        !Number.isSafeInteger(currentMerchandiseBdt)
      ) {
        throw new Error("The Order item totals do not match its saved total.");
      }
      const grossAmountBdt = unitPriceBdt * input.quantity;
      const merchandiseGrossBdt = currentMerchandiseBdt + grossAmountBdt;
      const totalBdt =
        merchandiseGrossBdt + row.deliveryAmountBdt - row.manualDiscountBdt;
      if (
        !Number.isSafeInteger(grossAmountBdt) ||
        !Number.isSafeInteger(merchandiseGrossBdt) ||
        !Number.isSafeInteger(totalBdt)
      ) {
        throw new UnprocessableEntityException(
          "The updated Order amount exceeds the supported limit.",
          { errorCode: "ORDER_AMOUNT_LIMIT_EXCEEDED" },
        );
      }

      const reservation = await this.inventory.extendWithinTransaction(
        transaction,
        {
          commandId: randomUUID(),
          reservationId: row.reservationId,
          lines: [{ variantId: input.variantId, quantity: input.quantity }],
        },
      );
      if (reservation.status !== "held") {
        throw new ConflictException(
          "The Order stock reservation is no longer active.",
          { errorCode: "ORDER_RESERVATION_NOT_HELD" },
        );
      }

      if (existingLine) {
        const [updatedLine] = await transaction
          .update(customerOrderLine)
          .set({
            quantity: existingLine.quantity + input.quantity,
            grossAmountBdt: existingLine.grossAmountBdt + grossAmountBdt,
          })
          .where(
            and(
              eq(customerOrderLine.id, existingLine.id),
              eq(customerOrderLine.quantity, existingLine.quantity),
            ),
          )
          .returning({ id: customerOrderLine.id });
        if (!updatedLine) {
          throw new ConflictException(
            "The Order item changed before its quantity could be increased.",
            { errorCode: "ORDER_ITEMS_UPDATE_CONFLICT" },
          );
        }
      } else {
        await transaction.insert(customerOrderLine).values({
          orderId: row.id,
          variantId: variant.variantId,
          quantity: input.quantity,
          unitPriceBdt,
          grossAmountBdt,
          productSnapshot: {
            productName: variant.name,
            color: variant.color,
            sizeLabel: variant.sizeLabel,
            compareAtPriceBdt: variant.compareAtPriceBdt,
          },
        });
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({
          merchandiseGrossBdt,
          totalBdt,
          codAmountDueBdt: totalBdt,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(customerOrder.id, row.id))
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!updated?.updatedAt) {
        throw new ConflictException(
          "The Order changed before the item could be added.",
          { errorCode: "ORDER_ITEMS_UPDATE_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: existingLine
          ? "commerce.cod_order_item_quantity_increased"
          : "commerce.cod_order_item_added",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.updatedAt,
        reason: existingLine
          ? "Staff increased an existing Order item quantity."
          : "Staff added a catalog item to the Order.",
        metadata: {
          variantId: variant.variantId,
          quantity: input.quantity,
          previousQuantity: existingLine?.quantity ?? 0,
          resultingQuantity: (existingLine?.quantity ?? 0) + input.quantity,
          unitPriceBdt,
          grossAmountBdt,
          previousMerchandiseGrossBdt: row.merchandiseGrossBdt,
          merchandiseGrossBdt,
          manualDiscountBdt: row.manualDiscountBdt,
          previousCodAmountDueBdt: row.codAmountDueBdt,
          codAmountDueBdt: totalBdt,
          reservationId: row.reservationId,
        },
      });
    });

    return this.getManagementDetail(orderId);
  }

  async removeCatalogItem(
    orderId: string,
    variantId: string,
    expectedQuantity: number,
    staffId: string,
  ): Promise<OrderManagementDetail> {
    const normalizedVariantId = variantId.toLowerCase();
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          collectionStatus: customerOrder.collectionStatus,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
          merchandiseGrossBdt: customerOrder.merchandiseGrossBdt,
          manualDiscountBdt: customerOrder.manualDiscountBdt,
          deliveryAmountBdt: customerOrder.deliveryAmountBdt,
          reservationId: customerOrder.reservationId,
          totalBdt: customerOrder.totalBdt,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();

      const lines = await transaction
        .select({
          id: customerOrderLine.id,
          variantId: customerOrderLine.variantId,
          quantity: customerOrderLine.quantity,
          productSnapshot: customerOrderLine.productSnapshot,
          unitPriceBdt: customerOrderLine.unitPriceBdt,
          grossAmountBdt: customerOrderLine.grossAmountBdt,
        })
        .from(customerOrderLine)
        .where(eq(customerOrderLine.orderId, row.id))
        .orderBy(asc(customerOrderLine.variantId));
      const line = lines.find((item) => item.variantId === normalizedVariantId);
      if (!line || line.quantity !== expectedQuantity) {
        throw new ConflictException(
          "The Order item changed. Refresh the Order before trying again.",
          { errorCode: "ORDER_ITEM_QUANTITY_CHANGED" },
        );
      }
      if (lines.length < 2) {
        throw new ConflictException(
          "An Order must contain at least one item. Cancel the Order to close it.",
          { errorCode: "ORDER_LAST_ITEM" },
        );
      }

      const [pathaoClaim] = await transaction
        .select({ orderId: orderPathaoBookingClaim.orderId })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .for("update")
        .limit(1);
      if (pathaoClaim) {
        throw new ConflictException(
          "Items cannot be changed while a Pathao consignment exists for this Order.",
          { errorCode: "ORDER_PATHAO_BOOKING_BLOCKS_ITEM_EDIT" },
        );
      }
      if (!canEditOrderPricing(row, false)) {
        throw new ConflictException(
          "Only pending or confirmed, unbooked Orders with an uncollected COD amount can have items changed.",
          { errorCode: "ORDER_ITEMS_NOT_EDITABLE" },
        );
      }

      const currentMerchandiseBdt = lines.reduce(
        (total, item) => total + item.grossAmountBdt,
        0,
      );
      if (
        currentMerchandiseBdt !== row.merchandiseGrossBdt ||
        row.totalBdt !==
          row.merchandiseGrossBdt +
            row.deliveryAmountBdt -
            row.manualDiscountBdt ||
        row.codAmountDueBdt !== row.totalBdt ||
        !Number.isSafeInteger(currentMerchandiseBdt)
      ) {
        throw new Error("The Order item totals do not match its saved total.");
      }

      const merchandiseGrossBdt = currentMerchandiseBdt - line.grossAmountBdt;
      if (row.manualDiscountBdt > merchandiseGrossBdt) {
        throw new ConflictException(
          "Reduce the order discount before removing this item.",
          { errorCode: "ORDER_DISCOUNT_EXCEEDS_MERCHANDISE" },
        );
      }
      const totalBdt =
        merchandiseGrossBdt + row.deliveryAmountBdt - row.manualDiscountBdt;
      if (
        merchandiseGrossBdt < 0 ||
        !Number.isSafeInteger(merchandiseGrossBdt) ||
        !Number.isSafeInteger(totalBdt) ||
        totalBdt <= 0
      ) {
        throw new UnprocessableEntityException(
          "The updated Order amount is invalid.",
          { errorCode: "ORDER_AMOUNT_LIMIT_EXCEEDED" },
        );
      }

      const reservation = await this.inventory.releaseLinesWithinTransaction(
        transaction,
        {
          commandId: randomUUID(),
          reservationId: row.reservationId,
          lines: [{ variantId: line.variantId, quantity: line.quantity }],
        },
      );
      if (reservation.status !== "held") {
        throw new ConflictException(
          "The Order stock reservation is no longer active.",
          { errorCode: "ORDER_RESERVATION_NOT_HELD" },
        );
      }

      const [removedLine] = await transaction
        .delete(customerOrderLine)
        .where(
          and(
            eq(customerOrderLine.id, line.id),
            eq(customerOrderLine.quantity, expectedQuantity),
          ),
        )
        .returning({ id: customerOrderLine.id });
      if (!removedLine) {
        throw new ConflictException(
          "The Order item changed before it could be removed.",
          { errorCode: "ORDER_ITEM_QUANTITY_CHANGED" },
        );
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({
          merchandiseGrossBdt,
          totalBdt,
          codAmountDueBdt: totalBdt,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(customerOrder.id, row.id))
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!updated?.updatedAt) {
        throw new ConflictException(
          "The Order changed before the item could be removed.",
          { errorCode: "ORDER_ITEMS_UPDATE_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_item_removed",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.updatedAt,
        reason: "Staff removed an item from the Order.",
        metadata: {
          removedItem: {
            variantId: line.variantId,
            productSnapshot: line.productSnapshot,
            quantity: line.quantity,
            unitPriceBdt: line.unitPriceBdt,
            grossAmountBdt: line.grossAmountBdt,
          },
          previousMerchandiseGrossBdt: row.merchandiseGrossBdt,
          merchandiseGrossBdt,
          manualDiscountBdt: row.manualDiscountBdt,
          previousCodAmountDueBdt: row.codAmountDueBdt,
          codAmountDueBdt: totalBdt,
          reservationId: row.reservationId,
        },
      });
    });

    return this.getManagementDetail(orderId);
  }

  async updateManualDiscount(
    orderId: string,
    staffId: string,
    input: OrderManualDiscountUpdateInput,
  ): Promise<OrderManagementDetail> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          collectionStatus: customerOrder.collectionStatus,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
          merchandiseGrossBdt: customerOrder.merchandiseGrossBdt,
          manualDiscountBdt: customerOrder.manualDiscountBdt,
          deliveryAmountBdt: customerOrder.deliveryAmountBdt,
          reservationId: customerOrder.reservationId,
          totalBdt: customerOrder.totalBdt,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();

      const [pathaoClaim] = await transaction
        .select({ orderId: orderPathaoBookingClaim.orderId })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .for("update")
        .limit(1);
      if (pathaoClaim) {
        throw new ConflictException(
          "The discount cannot be changed while a Pathao consignment exists for this order.",
          { errorCode: "ORDER_PATHAO_BOOKING_BLOCKS_DISCOUNT_EDIT" },
        );
      }
      if (!canEditOrderPricing(row, false)) {
        throw new ConflictException(
          "A discount can only be changed on a pending or confirmed, unbooked order with uncollected COD.",
          { errorCode: "ORDER_DISCOUNT_NOT_EDITABLE" },
        );
      }
      if (
        row.totalBdt !==
          row.merchandiseGrossBdt +
            row.deliveryAmountBdt -
            row.manualDiscountBdt ||
        row.codAmountDueBdt !== row.totalBdt
      ) {
        throw new Error("The Order totals do not match its saved amounts.");
      }

      if (
        row.manualDiscountBdt !== input.expectedManualDiscountBdt &&
        row.manualDiscountBdt !== input.manualDiscountBdt
      ) {
        throw new ConflictException(
          "The order discount changed. Refresh the order before saving again.",
          { errorCode: "ORDER_DISCOUNT_CHANGED" },
        );
      }
      if (input.manualDiscountBdt > row.merchandiseGrossBdt) {
        throw new UnprocessableEntityException(
          "The discount cannot exceed the merchandise subtotal.",
          { errorCode: "ORDER_DISCOUNT_EXCEEDS_MERCHANDISE" },
        );
      }
      if (input.manualDiscountBdt === row.manualDiscountBdt) return;

      const totalBdt =
        row.merchandiseGrossBdt +
        row.deliveryAmountBdt -
        input.manualDiscountBdt;
      if (!Number.isSafeInteger(totalBdt) || totalBdt <= 0) {
        throw new UnprocessableEntityException(
          "The updated Order amount is invalid.",
          { errorCode: "ORDER_AMOUNT_LIMIT_EXCEEDED" },
        );
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({
          manualDiscountBdt: input.manualDiscountBdt,
          totalBdt,
          codAmountDueBdt: totalBdt,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(customerOrder.id, row.id))
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!updated?.updatedAt) {
        throw new ConflictException(
          "The Order changed before its discount could be updated.",
          { errorCode: "ORDER_DISCOUNT_UPDATE_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_manual_discount_updated",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.updatedAt,
        reason: input.reason,
        metadata: {
          previousManualDiscountBdt: row.manualDiscountBdt,
          manualDiscountBdt: input.manualDiscountBdt,
          merchandiseGrossBdt: row.merchandiseGrossBdt,
          deliveryAmountBdt: row.deliveryAmountBdt,
          previousTotalBdt: row.totalBdt,
          totalBdt,
          previousCodAmountDueBdt: row.codAmountDueBdt,
          codAmountDueBdt: totalBdt,
          reservationId: row.reservationId,
        },
      });
    });

    return this.getManagementDetail(orderId);
  }

  async getPathaoBookingSnapshot(
    orderId: string,
  ): Promise<PathaoOrderBookingSnapshot> {
    const [row] = await this.database.db
      .select({
        id: customerOrder.id,
        reference: customerOrder.reference,
        status: customerOrder.status,
        fulfillmentStatus: customerOrder.fulfillmentStatus,
        addressSnapshot: customerOrder.addressSnapshot,
        codAmountDueBdt: customerOrder.codAmountDueBdt,
        itemQuantity: sql<number>`(
          select coalesce(sum(${customerOrderLine.quantity}), 0)::integer
          from ${customerOrderLine}
          where ${customerOrderLine.orderId} = ${orderId}::uuid
        )`,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!row) throw orderNotFound();
    if (
      row.status !== "confirmed" ||
      row.fulfillmentStatus !== "awaiting_dispatch"
    ) {
      throw new ConflictException(
        "Only confirmed Orders awaiting courier pickup can be booked with Pathao.",
        { errorCode: "PATHAO_ORDER_NOT_ELIGIBLE" },
      );
    }
    return toPathaoBookingSnapshot(row, row.itemQuantity);
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
    expectedItemQuantity?: number,
  ): Promise<PathaoOrderBookingSnapshot> {
    return this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          reference: customerOrder.reference,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          addressSnapshot: customerOrder.addressSnapshot,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (
        row.status !== "confirmed" ||
        row.fulfillmentStatus !== "awaiting_dispatch"
      ) {
        throw new ConflictException(
          "Only confirmed Orders awaiting courier pickup can be booked with Pathao.",
          { errorCode: "PATHAO_ORDER_NOT_ELIGIBLE" },
        );
      }
      const makeSnapshot = async () => {
        const [lineTotals] = await transaction
          .select({
            itemQuantity: sql<number>`coalesce(sum(${customerOrderLine.quantity}), 0)::integer`,
          })
          .from(customerOrderLine)
          .where(eq(customerOrderLine.orderId, row.id));
        const snapshot = toPathaoBookingSnapshot(
          row,
          lineTotals?.itemQuantity ?? 0,
        );
        if (
          expectedItemQuantity !== undefined &&
          snapshot.itemQuantity !== expectedItemQuantity
        ) {
          throw new ConflictException(
            "Order items changed while the Pathao booking was being prepared. Refresh and try again.",
            { errorCode: "PATHAO_ORDER_CHANGED" },
          );
        }
        return snapshot;
      };
      const [claim] = await transaction
        .select({
          commandId: orderPathaoBookingClaim.commandId,
          requestFingerprint: orderPathaoBookingClaim.requestFingerprint,
          status: orderPathaoBookingClaim.status,
        })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, orderId))
        .for("update")
        .limit(1);
      if (claim) {
        if (
          claim.commandId === commandId &&
          claim.requestFingerprint === requestFingerprint
        ) {
          return makeSnapshot();
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
      return makeSnapshot();
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

  async setPathaoBookingClaimWithinTransaction(
    transaction: AuditTransaction,
    update: PathaoBookingClaimUpdate,
  ): Promise<void> {
    await this.setPathaoBookingClaimsWithinTransaction(transaction, [update]);
  }

  async setPathaoBookingClaimsWithinTransaction(
    transaction: AuditTransaction,
    updates: readonly PathaoBookingClaimUpdate[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await transaction
      .insert(orderPathaoBookingClaim)
      .values(
        updates.map((update) => ({
          ...update,
          updatedAt: sql`clock_timestamp()`,
        })),
      )
      .onConflictDoUpdate({
        target: orderPathaoBookingClaim.orderId,
        set: {
          status: sql`excluded.status`,
          lastErrorCode: sql`excluded.last_error_code`,
          updatedAt: sql`clock_timestamp()`,
        },
        setWhere: sql`${orderPathaoBookingClaim.commandId} = excluded.command_id
          AND ${orderPathaoBookingClaim.requestFingerprint} = excluded.request_fingerprint`,
      });
  }

  async releasePathaoBookingClaimWithinTransaction(
    transaction: AuditTransaction,
    orderId: string,
  ): Promise<boolean> {
    const [order] = await transaction
      .select({
        status: customerOrder.status,
        fulfillmentStatus: customerOrder.fulfillmentStatus,
        dispatchedAt: customerOrder.dispatchedAt,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .for("update")
      .limit(1);
    if (
      !order ||
      order.status !== "confirmed" ||
      order.fulfillmentStatus !== "awaiting_dispatch" ||
      order.dispatchedAt !== null
    ) {
      return false;
    }

    const [claim] = await transaction
      .select({ status: orderPathaoBookingClaim.status })
      .from(orderPathaoBookingClaim)
      .where(eq(orderPathaoBookingClaim.orderId, orderId))
      .for("update")
      .limit(1);
    if (!claim) return true;
    if (claim.status !== "booked") return false;

    const [released] = await transaction
      .delete(orderPathaoBookingClaim)
      .where(
        and(
          eq(orderPathaoBookingClaim.orderId, orderId),
          eq(orderPathaoBookingClaim.status, "booked"),
        ),
      )
      .returning({ orderId: orderPathaoBookingClaim.orderId });
    return Boolean(released);
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
        .select({
          commandId: orderPathaoBookingClaim.commandId,
          requestFingerprint: orderPathaoBookingClaim.requestFingerprint,
          status: orderPathaoBookingClaim.status,
        })
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

  async getStaleSubmittingPathaoBookingClaims(
    transaction: AuditTransaction,
    limit: number,
  ): Promise<PathaoBookingClaimUpdate[]> {
    return transaction
      .select({
        orderId: orderPathaoBookingClaim.orderId,
        commandId: orderPathaoBookingClaim.commandId,
        requestFingerprint: orderPathaoBookingClaim.requestFingerprint,
        status: orderPathaoBookingClaim.status,
        lastErrorCode: orderPathaoBookingClaim.lastErrorCode,
      })
      .from(orderPathaoBookingClaim)
      .where(
        sql`${orderPathaoBookingClaim.status} = 'submitting' and ${orderPathaoBookingClaim.createdAt} <= clock_timestamp() - interval '15 seconds'`,
      )
      .orderBy(
        asc(orderPathaoBookingClaim.createdAt),
        asc(orderPathaoBookingClaim.orderId),
      )
      .for("update", { skipLocked: true })
      .limit(limit);
  }

  async removeOrphanedPathaoBookingClaims(
    transaction: AuditTransaction,
    claims: readonly PathaoBookingClaimIdentity[],
  ): Promise<void> {
    if (claims.length === 0) return;
    await transaction
      .delete(orderPathaoBookingClaim)
      .where(
        and(
          eq(orderPathaoBookingClaim.status, "submitting"),
          sql`${orderPathaoBookingClaim.createdAt} <= clock_timestamp() - interval '15 seconds'`,
          or(
            ...claims.map((claim) =>
              and(
                eq(orderPathaoBookingClaim.orderId, claim.orderId),
                eq(orderPathaoBookingClaim.commandId, claim.commandId),
                eq(
                  orderPathaoBookingClaim.requestFingerprint,
                  claim.requestFingerprint,
                ),
              ),
            ),
          ),
        ),
      );
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

  async authorizePathaoTrackingRead(
    orderId: string,
    customerId: string | undefined,
    signedCookies: Record<string, string>,
  ): Promise<void> {
    await this.getForOwner(orderId, customerId, signedCookies);
  }

  async getOrderIdForCustomerTracking(
    reference: string,
    phone: string,
  ): Promise<string> {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeBangladeshMobile(phone);
    } catch {
      throw customerTrackingOrderNotFound();
    }

    const [row] = await this.database.db
      .select({
        id: customerOrder.id,
      })
      .from(customerOrder)
      .where(
        and(
          eq(customerOrder.reference, reference),
          eq(
            sql<string>`${customerOrder.addressSnapshot}->>'phone'`,
            normalizedPhone,
          ),
        ),
      )
      .limit(1);
    if (!row) throw customerTrackingOrderNotFound();
    return row.id;
  }

  async updateManualStatus(
    orderId: string,
    staffId: string,
    input: OrderStatusUpdateInput,
  ): Promise<OrderManagementDetail> {
    if (input.status === "pending") {
      await this.setOrderPending(orderId, staffId, input.reason);
      return this.getManagementDetail(orderId);
    }
    if (input.status === "cancelled") {
      await this.cancelBeforeDispatch(orderId, staffId, input.reason);
      return this.getManagementDetail(orderId);
    }
    if (input.status === "no_answer") {
      await this.markNoAnswer(orderId, staffId);
      return this.getManagementDetail(orderId);
    }

    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          cancellationReason: customerOrder.cancellationReason,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();

      if (input.status === "confirmed") {
        if (
          row.status === "confirmed" &&
          row.fulfillmentStatus === "awaiting_dispatch"
        ) {
          return;
        }
        if (!availableOrderStatusActions(row, false).includes("confirmed")) {
          throw new ConflictException(
            "Only a pending or on-hold order can be confirmed.",
            { errorCode: "ORDER_STATUS_TRANSITION_INVALID" },
          );
        }

        const [updated] = await transaction
          .update(customerOrder)
          .set({
            status: "confirmed",
            fulfillmentStatus: "awaiting_dispatch",
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(customerOrder.id, row.id))
          .returning({ updatedAt: customerOrder.updatedAt });
        if (!updated?.updatedAt) {
          throw new ConflictException(
            "The Order changed before its status could be updated.",
            { errorCode: "ORDER_STATUS_TRANSITION_CONFLICT" },
          );
        }

        await this.audit.append(transaction, {
          actorType: "user",
          actorId: staffId,
          eventType:
            row.status === "on_hold"
              ? "commerce.cod_order_resumed"
              : "commerce.cod_order_confirmed",
          subjectType: "order",
          subjectId: row.id,
          occurredAt: updated.updatedAt,
          reason:
            input.reason ??
            "Customer confirmed the order and delivery details.",
          metadata: { previousStatus: row.status, status: "confirmed" },
        });
        return;
      }

      if (row.status === "on_hold") return;
      if (!availableOrderStatusActions(row, false).includes("on_hold")) {
        throw new ConflictException(
          "Only a pending order or confirmed order awaiting courier pickup can be put on hold.",
          { errorCode: "ORDER_STATUS_TRANSITION_INVALID" },
        );
      }

      const [pathaoClaim] = await transaction
        .select({ status: orderPathaoBookingClaim.status })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .limit(1);
      if (pathaoClaim) {
        throw new ConflictException(
          "Resolve the Pathao consignment before putting this Order on hold.",
          { errorCode: "ORDER_PATHAO_BOOKING_REQUIRES_RECONCILIATION" },
        );
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({ status: "on_hold", updatedAt: sql`clock_timestamp()` })
        .where(eq(customerOrder.id, row.id))
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!updated?.updatedAt) {
        throw new ConflictException(
          "The Order changed before it could be put on hold.",
          { errorCode: "ORDER_STATUS_TRANSITION_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_put_on_hold",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.updatedAt,
        reason: input.reason ?? "Customer requested the order be put on hold.",
        metadata: { previousStatus: row.status, status: "on_hold" },
      });
    });
    return this.getManagementDetail(orderId);
  }

  private async setOrderPending(
    orderId: string,
    staffId: string,
    reason?: string,
  ): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          cancellationReason: customerOrder.cancellationReason,
          reservationId: customerOrder.reservationId,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (row.status === "pending") return;

      const returningConfirmedOrder =
        row.status === "confirmed" &&
        row.fulfillmentStatus === "awaiting_dispatch";
      const reopeningCancelledOrder =
        row.status === "cancelled" &&
        row.fulfillmentStatus === "cancelled" &&
        row.cancellationReason !== null;
      if (!returningConfirmedOrder && !reopeningCancelledOrder) {
        throw new ConflictException(
          "Only an unbooked confirmed Order can be returned to pending, or a cancelled Order reopened.",
          { errorCode: "ORDER_STATUS_TRANSITION_INVALID" },
        );
      }

      const [pathaoClaim] = await transaction
        .select({ status: orderPathaoBookingClaim.status })
        .from(orderPathaoBookingClaim)
        .where(eq(orderPathaoBookingClaim.orderId, row.id))
        .for("update")
        .limit(1);
      const hasPathaoClaim = pathaoClaim !== undefined;

      if (returningConfirmedOrder) {
        if (hasPathaoClaim) {
          throw new ConflictException(
            "Resolve the Pathao consignment before returning this Order to pending.",
            { errorCode: "ORDER_PATHAO_BOOKING_REQUIRES_RECONCILIATION" },
          );
        }

        if (!availableOrderStatusActions(row, false).includes("pending")) {
          throw new ConflictException(
            "This Order cannot be returned to pending in its current state.",
            { errorCode: "ORDER_STATUS_TRANSITION_INVALID" },
          );
        }

        const [returned] = await transaction
          .update(customerOrder)
          .set({
            status: "pending",
            fulfillmentStatus: "not_started",
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(customerOrder.id, row.id),
              eq(customerOrder.status, "confirmed"),
              eq(customerOrder.fulfillmentStatus, "awaiting_dispatch"),
            ),
          )
          .returning({ updatedAt: customerOrder.updatedAt });
        if (!returned?.updatedAt) {
          throw new ConflictException(
            "The Order changed before it could be returned to pending.",
            { errorCode: "ORDER_STATUS_TRANSITION_CONFLICT" },
          );
        }

        await this.audit.append(transaction, {
          actorType: "user",
          actorId: staffId,
          eventType: "commerce.cod_order_returned_to_pending",
          subjectType: "order",
          subjectId: row.id,
          occurredAt: returned.updatedAt,
          reason:
            reason ?? "Staff returned the unbooked Order for reconfirmation.",
          metadata: { previousStatus: "confirmed", status: "pending" },
        });
        return;
      }

      if (hasPathaoClaim) {
        throw new ConflictException(
          "Resolve the Pathao consignment before reopening this Order.",
          { errorCode: "ORDER_PATHAO_BOOKING_REQUIRES_RECONCILIATION" },
        );
      }

      const lines = await transaction
        .select({
          variantId: customerOrderLine.variantId,
          quantity: customerOrderLine.quantity,
        })
        .from(customerOrderLine)
        .where(eq(customerOrderLine.orderId, row.id));
      const currentVariants =
        await this.catalog.findPurchasableVariantsWithinTransaction(
          transaction,
          lines.map(({ variantId }) => variantId),
        );
      const purchasableVariantIds = new Set(
        currentVariants.map((variant) => variant.variantId),
      );
      if (
        lines.length === 0 ||
        lines.some(({ variantId }) => !purchasableVariantIds.has(variantId))
      ) {
        throw new ConflictException(
          "This Order cannot be reopened because an item is no longer for sale. Create a new Order instead.",
          { errorCode: "ORDER_REOPEN_REQUIRES_REORDER" },
        );
      }

      const reservation = await this.inventory.reserveWithinTransaction(
        transaction,
        {
          commandId: randomUUID(),
          lines: lines.map(({ variantId, quantity }) => ({
            variantId,
            quantity,
          })),
        },
      );
      const [reopened] = await transaction
        .update(customerOrder)
        .set({
          status: "pending",
          fulfillmentStatus: "not_started",
          reservationId: reservation.id,
          cancellationReason: null,
          cancelledAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(customerOrder.id, row.id),
            eq(customerOrder.status, "cancelled"),
            eq(customerOrder.fulfillmentStatus, "cancelled"),
          ),
        )
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!reopened?.updatedAt) {
        throw new ConflictException(
          "The Order changed before it could be reopened.",
          { errorCode: "ORDER_STATUS_TRANSITION_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_reopened",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: reopened.updatedAt,
        reason: "Staff reopened the Order for customer confirmation.",
        metadata: {
          previousStatus: "cancelled",
          status: "pending",
          previousReservationId: row.reservationId,
          reservationId: reservation.id,
        },
      });
    });
  }

  private async markNoAnswer(orderId: string, staffId: string): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          cancellationReason: customerOrder.cancellationReason,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (row.status === "no_answer") return;
      if (!availableOrderStatusActions(row, false).includes("no_answer")) {
        throw new ConflictException(
          "Only a pending order can be marked no answer.",
          { errorCode: "ORDER_STATUS_TRANSITION_INVALID" },
        );
      }

      const [updated] = await transaction
        .update(customerOrder)
        .set({ status: "no_answer", updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(customerOrder.id, row.id),
            eq(customerOrder.status, "pending"),
            eq(customerOrder.fulfillmentStatus, "not_started"),
          ),
        )
        .returning({ updatedAt: customerOrder.updatedAt });
      if (!updated?.updatedAt) {
        throw new ConflictException(
          "The Order changed before the no-answer outcome could be saved.",
          { errorCode: "ORDER_STATUS_TRANSITION_CONFLICT" },
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.cod_order_no_answer",
        subjectType: "order",
        subjectId: row.id,
        occurredAt: updated.updatedAt,
        reason: "Customer did not answer the order call.",
        metadata: { previousStatus: row.status, status: "no_answer" },
      });
    });
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
          .select({
            id: customerOrder.id,
            status: customerOrder.status,
            fulfillmentStatus: customerOrder.fulfillmentStatus,
            dispatchCommandId: customerOrder.dispatchCommandId,
            dispatchRequestFingerprint:
              customerOrder.dispatchRequestFingerprint,
            reservationId: customerOrder.reservationId,
          })
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
              "This courier handoff was already recorded with a different command or payload.",
              { errorCode: "ORDER_ALREADY_DISPATCHED" },
            );
          }
          return;
        }

        if (
          row.status !== "confirmed" ||
          row.fulfillmentStatus !== "awaiting_dispatch"
        ) {
          throw new ConflictException(
            "Only a confirmed Order awaiting courier pickup can have its pickup recorded.",
            { errorCode: "ORDER_NOT_DISPATCHABLE" },
          );
        }

        const [pathaoClaim] = await transaction
          .select({ status: orderPathaoBookingClaim.status })
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
              ? "Resolve the Pathao booking outcome before recording pickup."
              : "The delivery provider must match the Order's confirmed Pathao booking.",
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
              eq(customerOrder.fulfillmentStatus, "awaiting_dispatch"),
            ),
          )
          .returning({ dispatchedAt: customerOrder.dispatchedAt });
        if (!dispatched?.dispatchedAt) {
          throw new ConflictException(
            "The Order changed before courier pickup could be recorded.",
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

  async cancelBeforeDispatch(
    orderId: string,
    staffId: string,
    reason: string,
  ): Promise<Order> {
    await this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          cancellationReason: customerOrder.cancellationReason,
          reservationId: customerOrder.reservationId,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!row) throw orderNotFound();
      if (row.status === "cancelled") return;
      if (!availableOrderStatusActions(row, false).includes("cancelled")) {
        throw new ConflictException(
          "Only a pending order, an order on hold, or a confirmed order awaiting courier pickup can be cancelled.",
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
            eq(customerOrder.status, row.status),
            eq(customerOrder.fulfillmentStatus, row.fulfillmentStatus),
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
        reason,
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
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          fulfillmentOutcomeReason: customerOrder.fulfillmentOutcomeReason,
          dispatchedAt: customerOrder.dispatchedAt,
          deliveryProvider: customerOrder.deliveryProvider,
        })
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
        .select({
          id: customerOrder.id,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          collectionStatus: customerOrder.collectionStatus,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
          collectionReason: customerOrder.collectionReason,
        })
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

  private resolveAddress(
    input: CheckoutAddressInput,
    destination: AuthoritativeQuote["destination"],
  ): NormalizedAddress {
    const phone = normalizeBangladeshMobile(input.phone);
    return OrderAddressSchema.parse({
      recipientName: normalizeAddressText(input.recipientName),
      phone,
      geographyVersion: destination.geographyVersion,
      divisionId: destination.divisionId,
      divisionName: destination.divisionName,
      districtId: destination.districtId,
      districtName: destination.districtName,
      upazilaId: destination.upazilaId,
      upazilaName: destination.upazilaName,
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
  ): Promise<CheckoutReplay | null> {
    const [prior] = await this.database.db
      .select({
        order: {
          id: customerOrder.id,
          reference: customerOrder.reference,
          totalBdt: customerOrder.totalBdt,
          codAmountDueBdt: customerOrder.codAmountDueBdt,
          status: customerOrder.status,
          paymentMethod: customerOrder.paymentMethod,
          collectionStatus: customerOrder.collectionStatus,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          createdAt: customerOrder.createdAt,
          guestAccessExpiresAt: customerOrder.guestAccessExpiresAt,
          customerId: customerOrder.customerId,
          guestCartHash: customerOrder.guestCartHash,
          guestAccessTokenHash: customerOrder.guestAccessTokenHash,
          cartRevision: customerOrder.cartRevision,
        },
        requestFingerprint: orderIdempotency.requestFingerprint,
        guestAccessStillValid: sql<boolean>`coalesce(${customerOrder.guestAccessExpiresAt} > now(), false)`,
      })
      .from(orderIdempotency)
      .innerJoin(customerOrder, eq(customerOrder.id, orderIdempotency.orderId))
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
    return {
      order: prior.order,
      guestAccessStillValid: prior.guestAccessStillValid,
    };
  }

  private async hasValidGuestCredential(
    row: OrderRow,
    signedCookies: Record<string, string>,
    guestAccessStillValid: boolean,
  ): Promise<boolean> {
    return this.matchesGuestCredential(
      row,
      signedCookies[guestOrderCookieName(row.id)],
      guestAccessStillValid,
    );
  }

  private async loadPrivateOrder(row: OrderRow): Promise<Order> {
    const lines = await this.database.db
      .select()
      .from(customerOrderLine)
      .where(eq(customerOrderLine.orderId, row.id))
      .orderBy(asc(customerOrderLine.variantId));
    const address = parseStoredOrderAddress(row.addressSnapshot);
    return OrderSchema.parse({
      id: row.id,
      reference: row.reference,
      currency: CURRENCY,
      status: row.status,
      paymentMethod: row.paymentMethod,
      collectionStatus: row.collectionStatus,
      collectedAmountBdt: row.collectedAmountBdt,
      fulfillmentStatus: row.fulfillmentStatus,
      courierHandoff:
        row.dispatchedAt !== null &&
        row.deliveryOperator !== null &&
        row.dispatchCommandId !== null
          ? {
              deliveryProvider: row.deliveryProvider,
              deliveryOperator: row.deliveryOperator,
              handoffReference: row.handoffReference,
              pickedUpAt: row.dispatchedAt.toISOString(),
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
      manualDiscountBdt: row.manualDiscountBdt,
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

function fingerprintDraftPreview(
  draftId: string,
  version: number,
  address: CheckoutAddressInput,
  priced: {
    lines: readonly {
      variantId: string;
      quantity: number;
      unitPriceBdt: number;
      grossAmountBdt: number;
    }[];
    merchandiseGrossBdt: number;
    tariff: {
      feeBdt: number;
      version: string;
      effectiveFrom: string;
      zone: string | null;
    };
    totalBdt: number;
  },
): string {
  return sha256(
    JSON.stringify({
      draftId,
      version,
      address,
      lines: priced.lines.map((line) => [
        line.variantId,
        line.quantity,
        line.unitPriceBdt,
        line.grossAmountBdt,
      ]),
      merchandiseGrossBdt: priced.merchandiseGrossBdt,
      tariff: [
        priced.tariff.version,
        priced.tariff.effectiveFrom,
        priced.tariff.zone,
        priced.tariff.feeBdt,
      ],
      totalBdt: priced.totalBdt,
    }),
  );
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

function toPathaoBookingSnapshot(
  row: PathaoSnapshotOrderRow,
  itemQuantity: number,
): PathaoOrderBookingSnapshot {
  const address = parseStoredOrderAddress(row.addressSnapshot);
  const recipientAddress = [
    address.house,
    address.street,
    address.doorstepDetails,
    address.upazilaName,
    address.districtName,
    address.divisionName,
    address.postalCode,
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    fulfillmentStatus: row.fulfillmentStatus,
    recipientName: address.recipientName,
    recipientPhone: address.phone,
    recipientAddress,
    customerInstructions: address.instructions,
    itemQuantity,
    codAmountDueBdt: row.codAmountDueBdt,
  };
}

function dispatchCommandConflict(): ConflictException {
  return new ConflictException(
    "This handoff command ID was already used for a different Order or payload.",
    { errorCode: "IDEMPOTENCY_KEY_REUSED" },
  );
}

function assertIdempotencyFingerprint(
  prior: Pick<IdempotencyRow, "requestFingerprint">,
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

function toCreated(row: OrderCreatedRow, replayed: boolean): OrderCreated {
  return OrderCreatedSchema.parse({
    id: row.id,
    reference: row.reference,
    totalBdt: row.totalBdt,
    codAmountDueBdt: row.codAmountDueBdt,
    status: row.status,
    paymentMethod: row.paymentMethod,
    collectionStatus: row.collectionStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    createdAt: row.createdAt.toISOString(),
    guestAccessExpiresAt: row.guestAccessExpiresAt?.toISOString() ?? null,
    replayed,
  });
}

function parseStoredOrderAddress(value: unknown): OrderAddress {
  const parsed = OrderAddressSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServiceUnavailableException(
      "The saved Order address is unavailable.",
      { errorCode: "ORDER_ADDRESS_UNAVAILABLE" },
    );
  }
  return parsed.data;
}

function shouldPrioritizeHeldOrders(query: OrderListQuery): boolean {
  return (
    query.status === "pending" ||
    query.status === "no_answer" ||
    query.status === "on_hold" ||
    query.fulfillmentStatus === "awaiting_dispatch"
  );
}

function managedOrderFilters(query: OrderListQuery) {
  return [
    query.status ? eq(customerOrder.status, query.status) : undefined,
    query.fulfillmentStatus
      ? eq(customerOrder.fulfillmentStatus, query.fulfillmentStatus)
      : undefined,
    query.createdFrom
      ? gte(customerOrder.createdAt, new Date(query.createdFrom))
      : undefined,
    query.createdBefore
      ? lt(customerOrder.createdAt, new Date(query.createdBefore))
      : undefined,
  ];
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
    compareAtPriceBdt:
      Number.isSafeInteger(product.compareAtPriceBdt) &&
      (product.compareAtPriceBdt as number) >= 0
        ? (product.compareAtPriceBdt as number)
        : null,
  };
}

function orderNotFound(): NotFoundException {
  return new NotFoundException("Order not found.", {
    errorCode: "ORDER_NOT_FOUND",
  });
}

function customerTrackingOrderNotFound(): NotFoundException {
  return new NotFoundException(
    "We couldn't find an order matching those details.",
    { errorCode: "ORDER_TRACKING_NOT_FOUND" },
  );
}

function orderAccessUnavailable(): ConflictException {
  return new ConflictException(
    "Online guest Order access is unavailable and cannot be restored automatically.",
    { errorCode: "ORDER_ACCESS_UNAVAILABLE" },
  );
}

function guestCartRevisionCondition(guestCartHash: string, revision: number) {
  return and(
    eq(customerOrder.guestCartHash, guestCartHash),
    eq(customerOrder.cartRevision, revision),
  );
}

function isGuestCartAlreadyCheckedOut(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "errorCode" in response &&
    response.errorCode === "ORDER_CART_ALREADY_CHECKED_OUT"
  );
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseExactOrderSearch(
  value: string,
): { kind: "reference" | "id"; value: string } | null {
  const reference = OrderReferenceSchema.safeParse(value.toUpperCase());
  if (reference.success) {
    return { kind: "reference", value: reference.data };
  }
  const id = OrderIdSchema.safeParse(value);
  return id.success ? { kind: "id", value: id.data } : null;
}

function normalizeOrderSearchText(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeOrderPhoneDigits(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[০-৯]/gu, (character) => String(character.charCodeAt(0) - 0x09e6))
    .replace(/\D/g, "");
}

function toCanonicalBangladeshPhonePrefix(value: string): string {
  return /^0\d{1,10}$/.test(value) ? `88${value}` : value;
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

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import {
  OrderReceiptSchema,
  type Order,
  type CourierRemittanceBatch,
  type CourierRemittanceBatches,
  type CreateOrderReturnInput,
  type DecideOrderReturnInput,
  type ImportCourierRemittanceInput,
  type InspectOrderReturnInput,
  type OrderReturnCase,
  type OrderReturnCases,
  type ReceiveOrderReturnInput,
  type RecordOrderReturnRefundInput,
  type ReconcileCourierRemittanceInput,
  type ResolveCourierRemittanceLineInput,
  type OrderReceipt,
  type ConfirmCourierSettlementInput,
} from "@aaraj/contracts";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { pathaoBooking } from "../delivery/pathao/pathao-schema.js";
import { InventoryPolicy } from "../inventory/inventory.policy.js";
import {
  INVENTORY_RETURN_PORT,
  type InventoryReturnPort,
} from "../inventory/inventory-return.port.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { OrdersFinancePolicy } from "../platform/authorization/orders-finance.policy.js";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { DatabaseService } from "../platform/database/database.service.js";
import {
  courierRemittanceBatch,
  courierRemittanceLine,
  customerOrder,
  customerOrderLine,
  orderDeliveryLine,
  orderReturnCase,
  orderReturnCaseLine,
  orderReturnInspection,
  orderReturnRefund,
  orderReceipt,
  orderReceiptCounter,
  courierSettlementConfirmation,
  courierSettlementJournal,
  courierSettlementJournalEntry,
} from "./orders-schema.js";
import { OrdersService } from "./orders.service.js";
import { decryptOrderAddress } from "./order-address-crypto.js";

const MAX_SAFE_BDT = BigInt(Number.MAX_SAFE_INTEGER);
const RETURN_CONSUMING_STATUSES = [
  "requested",
  "authorized",
  "received",
  "inspected",
  "refund_pending",
  "refunded",
  "closed",
] as const;

@Injectable()
export class OrdersOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    @Inject(INVENTORY_RETURN_PORT)
    private readonly inventoryReturns: InventoryReturnPort,
  ) {}

  async issueOrderReceipt(
    actor: AccessPrincipal,
    orderId: string,
  ): Promise<OrderReceipt> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    await this.database.db.transaction(async (transaction) => {
      const [order] = await transaction
        .select({
          id: customerOrder.id,
          reference: customerOrder.reference,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!order) throw orderNotFound();
      const [existing] = await transaction
        .select({ id: orderReceipt.id })
        .from(orderReceipt)
        .where(eq(orderReceipt.orderId, orderId))
        .limit(1);
      if (existing) return;
      if (
        order.status !== "confirmed" ||
        !["delivered", "returned"].includes(order.fulfillmentStatus)
      ) {
        throw new ConflictException(
          "A delivery receipt can be issued after the Order is fully delivered.",
          { errorCode: "ORDER_RECEIPT_NOT_ELIGIBLE" },
        );
      }

      const orderSnapshot = await this.orders.getForManagement(orderId);
      const snapshot = withoutOrderAddress(orderSnapshot);
      const year = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Dhaka",
          year: "numeric",
        }).format(new Date()),
      );
      const [counter] = await transaction
        .insert(orderReceiptCounter)
        .values({ year, lastNumber: 1 })
        .onConflictDoUpdate({
          target: orderReceiptCounter.year,
          set: { lastNumber: sql`${orderReceiptCounter.lastNumber} + 1` },
          setWhere: sql`${orderReceiptCounter.lastNumber} < 999999`,
        })
        .returning({ number: orderReceiptCounter.lastNumber });
      if (!counter) {
        throw new ServiceUnavailableException(
          "This year’s delivery receipt limit has been reached.",
          { errorCode: "ORDER_RECEIPT_CAPACITY_REACHED" },
        );
      }
      const receiptNumber = `AAR-${String(year).padStart(4, "0")}-${String(counter.number).padStart(6, "0")}`;
      const [created] = await transaction
        .insert(orderReceipt)
        .values({
          orderId,
          receiptNumber,
          sequenceYear: year,
          sequenceNumber: counter.number,
          snapshot,
          issuedBy: actor.id,
        })
        .returning({ id: orderReceipt.id, issuedAt: orderReceipt.issuedAt });
      if (!created) throw new Error("Delivery receipt insert returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.order_delivery_receipt_issued",
        subjectType: "order_receipt",
        subjectId: created.id,
        occurredAt: created.issuedAt,
        reason:
          "A durable delivery receipt was issued after verified Order delivery.",
        metadata: { orderId, orderReference: order.reference, receiptNumber },
      });
    });
    return this.readOrderReceipt(orderId);
  }

  async getOrderReceipt(
    actor: AccessPrincipal,
    orderId: string,
  ): Promise<OrderReceipt> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    return this.readOrderReceipt(orderId);
  }

  private async readOrderReceipt(orderId: string): Promise<OrderReceipt> {
    const [row] = await this.database.db
      .select({
        receipt: orderReceipt,
        addressCiphertext: customerOrder.addressCiphertext,
      })
      .from(orderReceipt)
      .innerJoin(customerOrder, eq(customerOrder.id, orderReceipt.orderId))
      .where(eq(orderReceipt.orderId, orderId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Order delivery receipt not found.", {
        errorCode: "ORDER_RECEIPT_NOT_FOUND",
      });
    }
    return OrderReceiptSchema.parse({
      id: row.receipt.id,
      receiptNumber: row.receipt.receiptNumber,
      documentType: "delivery_receipt",
      taxInvoice: false,
      issuedAt: row.receipt.issuedAt.toISOString(),
      order: {
        ...(row.receipt.snapshot as Record<string, unknown>),
        address: decryptOrderAddress(orderId, row.addressCiphertext),
      },
    });
  }

  async createReturnCase(
    actor: AccessPrincipal,
    orderId: string,
    input: CreateOrderReturnInput,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const fingerprint = requestFingerprint({
      orderId,
      origin: input.origin,
      reason: input.reason,
      lines: [...input.lines].sort(byVariant),
    });
    let returnCaseId = "";

    await this.database.db.transaction(async (transaction) => {
      const [order] = await transaction
        .select({
          id: customerOrder.id,
          reference: customerOrder.reference,
          status: customerOrder.status,
          fulfillmentStatus: customerOrder.fulfillmentStatus,
          collectionStatus: customerOrder.collectionStatus,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, orderId))
        .for("update")
        .limit(1);
      if (!order) throw orderNotFound();
      await lockCommand(transaction, input.commandId);
      const [prior] = await transaction
        .select({
          id: orderReturnCase.id,
          requestFingerprint: orderReturnCase.requestFingerprint,
        })
        .from(orderReturnCase)
        .where(eq(orderReturnCase.commandId, input.commandId))
        .limit(1);
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw idempotencyConflict("return case");
        }
        returnCaseId = prior.id;
        return;
      }

      const isCustomerReturn = input.origin === "customer_return";
      if (
        order.status !== "confirmed" ||
        ![
          "delivered",
          "partially_delivered",
          "returned",
          "delivery_failed",
        ].includes(order.fulfillmentStatus)
      ) {
        throw new ConflictException(
          "A return case can only be opened for a confirmed Order with a verified delivery or return outcome.",
          { errorCode: "ORDER_RETURN_NOT_ELIGIBLE" },
        );
      }
      if (
        isCustomerReturn &&
        !["delivered", "partially_delivered"].includes(order.fulfillmentStatus)
      ) {
        throw new ConflictException(
          "Customer returns require a delivered quantity on the Order.",
          { errorCode: "ORDER_RETURN_NOT_ELIGIBLE" },
        );
      }
      if (
        !isCustomerReturn &&
        !["returned", "delivery_failed"].includes(order.fulfillmentStatus)
      ) {
        throw new ConflictException(
          "Courier returns and doorstep refusals require a failed or returned delivery outcome.",
          { errorCode: "ORDER_RETURN_NOT_ELIGIBLE" },
        );
      }

      const orderLines = await transaction
        .select()
        .from(customerOrderLine)
        .where(eq(customerOrderLine.orderId, order.id))
        .for("update");
      const orderLineByVariant = new Map(
        orderLines.map((line) => [line.variantId, line]),
      );
      const requestedLines = input.lines.map((line) => {
        const orderLine = orderLineByVariant.get(line.variantId);
        if (!orderLine) throw returnQuantityConflict();
        return { request: line, orderLine };
      });
      const deliveryRows = await transaction
        .select()
        .from(orderDeliveryLine)
        .where(
          inArray(
            orderDeliveryLine.orderLineId,
            orderLines.map((line) => line.id),
          ),
        );
      if (
        order.fulfillmentStatus === "partially_delivered" &&
        deliveryRows.length !== orderLines.length
      ) {
        throw new ConflictException(
          "The Order needs verified per-line delivery quantities before a return can be opened.",
          { errorCode: "ORDER_DELIVERY_LINES_REQUIRED" },
        );
      }
      const deliveredByLine = new Map(
        deliveryRows.map((row) => [row.orderLineId, row.quantityDelivered]),
      );
      const priorRows = await transaction
        .select({
          status: orderReturnCase.status,
          orderLineId: orderReturnCaseLine.orderLineId,
          requestedQuantity: orderReturnCaseLine.requestedQuantity,
          receivedQuantity: orderReturnCaseLine.receivedQuantity,
        })
        .from(orderReturnCaseLine)
        .innerJoin(
          orderReturnCase,
          eq(orderReturnCase.id, orderReturnCaseLine.returnCaseId),
        )
        .where(
          and(
            eq(orderReturnCase.orderId, order.id),
            isCustomerReturn
              ? eq(orderReturnCase.origin, "customer_return")
              : inArray(orderReturnCase.origin, [
                  "courier_rts",
                  "doorstep_refusal",
                ]),
            inArray(orderReturnCase.status, [...RETURN_CONSUMING_STATUSES]),
            sql`(${orderReturnCase.status} not in ('closed', 'refunded') or ${orderReturnCaseLine.receivedQuantity} > 0)`,
          ),
        );
      const alreadyRequested = new Map<string, number>();
      for (const row of priorRows) {
        const consumedQuantity = ["closed", "refunded"].includes(row.status)
          ? row.receivedQuantity
          : row.requestedQuantity;
        alreadyRequested.set(
          row.orderLineId,
          (alreadyRequested.get(row.orderLineId) ?? 0) + consumedQuantity,
        );
      }

      let maximumRefund = 0n;
      for (const { request, orderLine } of requestedLines) {
        const delivered = deliveredByLine.get(orderLine.id);
        const eligibleQuantity = isCustomerReturn
          ? (delivered ?? 0)
          : orderLine.quantity - (delivered ?? 0);
        const remaining =
          eligibleQuantity - (alreadyRequested.get(orderLine.id) ?? 0);
        if (request.quantity > remaining) throw returnQuantityConflict();
        if (isCustomerReturn) {
          maximumRefund +=
            BigInt(orderLine.unitPriceBdt) * BigInt(request.quantity);
        }
      }
      if (maximumRefund > MAX_SAFE_BDT) {
        throw new ConflictException(
          "The return amount exceeds the supported limit.",
        );
      }

      const [created] = await transaction
        .insert(orderReturnCase)
        .values({
          orderId: order.id,
          origin: input.origin,
          status: isCustomerReturn ? "requested" : "authorized",
          reason: input.reason,
          maximumRefundAmountBdt: Number(maximumRefund),
          createdBy: actor.id,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
        })
        .returning({ id: orderReturnCase.id });
      if (!created) throw new Error("Return case insert returned no row.");
      returnCaseId = created.id;

      await transaction.insert(orderReturnCaseLine).values(
        requestedLines.map(({ request, orderLine }) => ({
          returnCaseId: created.id,
          orderLineId: orderLine.id,
          variantId: orderLine.variantId,
          productSnapshot: orderLine.productSnapshot,
          requestedQuantity: request.quantity,
          unitPriceBdt: orderLine.unitPriceBdt,
        })),
      );

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.order_return_case_created",
        subjectType: "order_return_case",
        subjectId: created.id,
        reason: input.reason,
        metadata: {
          orderId: order.id,
          origin: input.origin,
          lineCount: requestedLines.length,
          maximumRefundAmountBdt: Number(maximumRefund),
          initialStatus: isCustomerReturn ? "requested" : "authorized",
        },
      });
    });

    return this.readReturnCase(returnCaseId);
  }

  async decideReturnCase(
    actor: AccessPrincipal,
    returnCaseId: string,
    input: DecideOrderReturnInput,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const fingerprint = requestFingerprint({ returnCaseId, ...input });
    await this.database.db.transaction(async (transaction) => {
      const row = await this.lockReturnCase(transaction, returnCaseId);
      if (
        row.decisionCommandId === input.commandId &&
        row.decisionFingerprint === fingerprint
      ) {
        return;
      }
      if (row.status !== "requested" || row.origin !== "customer_return") {
        throw returnTransitionConflict(
          "Only a requested customer return can be approved or rejected.",
        );
      }
      const nextStatus =
        input.decision === "authorize" ? "authorized" : "rejected";
      const [updated] = await transaction
        .update(orderReturnCase)
        .set({
          status: nextStatus,
          decisionReason: input.reason,
          decisionCommandId: input.commandId,
          decisionFingerprint: fingerprint,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderReturnCase.id, returnCaseId))
        .returning({ occurredAt: orderReturnCase.updatedAt });
      if (!updated)
        throw returnTransitionConflict(
          "The return case changed during review.",
        );
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType:
          input.decision === "authorize"
            ? "commerce.order_return_authorized"
            : "commerce.order_return_rejected",
        subjectType: "order_return_case",
        subjectId: returnCaseId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: { status: nextStatus },
      });
    });
    return this.readReturnCase(returnCaseId);
  }

  async receiveReturn(
    actor: AccessPrincipal,
    returnCaseId: string,
    input: ReceiveOrderReturnInput,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const fingerprint = requestFingerprint({ returnCaseId, ...input });
    await this.database.db.transaction(async (transaction) => {
      const row = await this.lockReturnCase(transaction, returnCaseId);
      if (
        row.receivedCommandId === input.commandId &&
        row.receivedFingerprint === fingerprint
      ) {
        return;
      }
      if (row.status !== "authorized") {
        throw returnTransitionConflict(
          "Only an authorized return can be received.",
        );
      }
      const lines = await transaction
        .select()
        .from(orderReturnCaseLine)
        .where(eq(orderReturnCaseLine.returnCaseId, returnCaseId))
        .for("update");
      assertExactVariants(
        lines.map((line) => line.variantId),
        input.lines.map((line) => line.variantId),
      );
      let received = 0;
      const receivedByVariant = new Map(
        input.lines.map(({ variantId, quantityReceived }) => [
          variantId,
          quantityReceived,
        ]),
      );
      let receivedRefundValue = 0n;
      for (const line of lines) {
        const quantity = receivedByVariant.get(line.variantId)!;
        if (quantity > line.requestedQuantity) throw returnQuantityConflict();
        received += quantity;
        if (row.origin === "customer_return") {
          receivedRefundValue += BigInt(line.unitPriceBdt) * BigInt(quantity);
        }
        await transaction
          .update(orderReturnCaseLine)
          .set({ receivedQuantity: quantity })
          .where(eq(orderReturnCaseLine.id, line.id));
      }
      if (receivedRefundValue > MAX_SAFE_BDT) {
        throw new ConflictException(
          "The received return amount exceeds the supported limit.",
        );
      }
      const nextStatus = received > 0 ? "received" : "closed";
      const [updated] = await transaction
        .update(orderReturnCase)
        .set({
          status: nextStatus,
          receiptReason: input.reason,
          maximumRefundAmountBdt: Number(receivedRefundValue),
          receivedCommandId: input.commandId,
          receivedFingerprint: fingerprint,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderReturnCase.id, returnCaseId))
        .returning({ occurredAt: orderReturnCase.updatedAt });
      if (!updated)
        throw returnTransitionConflict(
          "The return case changed during receipt.",
        );
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.order_return_received",
        subjectType: "order_return_case",
        subjectId: returnCaseId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: { receivedQuantity: received, status: nextStatus },
      });
    });
    return this.readReturnCase(returnCaseId);
  }

  async inspectReturn(
    actor: AccessPrincipal,
    returnCaseId: string,
    input: InspectOrderReturnInput,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    await this.authorization.authorize(InventoryPolicy, "manage", actor);
    const fingerprint = requestFingerprint({ returnCaseId, ...input });
    await this.database.db.transaction(async (transaction) => {
      const row = await this.lockReturnCase(transaction, returnCaseId);
      if (
        row.inspectionCommandId === input.commandId &&
        row.inspectionFingerprint === fingerprint
      ) {
        return;
      }
      if (row.status !== "received") {
        throw returnTransitionConflict("Only received goods can be inspected.");
      }
      const lines = await transaction
        .select()
        .from(orderReturnCaseLine)
        .where(eq(orderReturnCaseLine.returnCaseId, returnCaseId))
        .for("update");
      assertExactVariants(
        lines.map((line) => line.variantId),
        input.lines.map((line) => line.variantId),
      );
      const inspectionByVariant = new Map(
        input.lines.map((line) => [line.variantId, line]),
      );
      for (const line of lines) {
        const inspected = inspectionByVariant.get(line.variantId)!;
        const inspectedQuantity = inspected.grades.reduce(
          (total, grade) => total + grade.quantity,
          0,
        );
        if (inspectedQuantity !== line.receivedQuantity) {
          throw new ConflictException(
            "Inspection grades must account for every unit physically received.",
            { errorCode: "ORDER_RETURN_INSPECTION_QUANTITY_MISMATCH" },
          );
        }
        const sellable = inspected.grades.find(
          ({ grade }) => grade === "sellable",
        );
        if (sellable && !inspected.restockCommandId) {
          throw new ConflictException(
            "A restock command ID is required for saleable returned goods.",
            { errorCode: "ORDER_RETURN_RESTOCK_COMMAND_REQUIRED" },
          );
        }
        for (const grade of inspected.grades) {
          const inspectionId = deterministicUuid(
            `${input.commandId}:${line.id}:${grade.grade}`,
          );
          await transaction.insert(orderReturnInspection).values({
            returnLineId: line.id,
            grade: grade.grade,
            quantity: grade.quantity,
            commandId: inspectionId,
            inspectedBy: actor.id,
            reason: input.reason,
          });
        }
        if (sellable && inspected.restockCommandId) {
          await this.inventoryReturns.restockReturnedGoodsWithinTransaction(
            transaction,
            {
              commandId: inspected.restockCommandId,
              variantId: line.variantId,
              quantity: sellable.quantity,
              actorId: actor.id,
              reason: input.reason,
            },
          );
        }
      }
      const nextStatus =
        row.origin === "customer_return" && row.maximumRefundAmountBdt > 0
          ? "refund_pending"
          : "closed";
      const [updated] = await transaction
        .update(orderReturnCase)
        .set({
          status: nextStatus,
          inspectionCommandId: input.commandId,
          inspectionFingerprint: fingerprint,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderReturnCase.id, returnCaseId))
        .returning({ occurredAt: orderReturnCase.updatedAt });
      if (!updated)
        throw returnTransitionConflict(
          "The return case changed during inspection.",
        );
      if (row.origin === "customer_return") {
        const [order] = await transaction
          .select({
            status: customerOrder.status,
            fulfillmentStatus: customerOrder.fulfillmentStatus,
          })
          .from(customerOrder)
          .where(eq(customerOrder.id, row.orderId))
          .for("update")
          .limit(1);
        const deliveredLines = await transaction
          .select({
            orderLineId: orderDeliveryLine.orderLineId,
            quantityDelivered: orderDeliveryLine.quantityDelivered,
          })
          .from(orderDeliveryLine)
          .where(eq(orderDeliveryLine.orderId, row.orderId));
        const returnedLines = await transaction
          .select({
            orderLineId: orderReturnCaseLine.orderLineId,
            quantityReturned: sql<number>`coalesce(sum(${orderReturnCaseLine.receivedQuantity}), 0)::integer`,
          })
          .from(orderReturnCaseLine)
          .innerJoin(
            orderReturnCase,
            eq(orderReturnCase.id, orderReturnCaseLine.returnCaseId),
          )
          .where(
            and(
              eq(orderReturnCase.orderId, row.orderId),
              eq(orderReturnCase.origin, "customer_return"),
              inArray(orderReturnCase.status, [
                "inspected",
                "refund_pending",
                "refunded",
                "closed",
              ]),
            ),
          )
          .groupBy(orderReturnCaseLine.orderLineId);
        const returnedQuantityByLine = new Map(
          returnedLines.map((line) => [
            line.orderLineId,
            line.quantityReturned,
          ]),
        );
        const anyDelivered = deliveredLines.some(
          (line) => line.quantityDelivered > 0,
        );
        const everyDeliveredUnitReturned =
          deliveredLines.length > 0 &&
          deliveredLines.every(
            (line) =>
              line.quantityDelivered === 0 ||
              (returnedQuantityByLine.get(line.orderLineId) ?? 0) >=
                line.quantityDelivered,
          );
        if (
          order?.status === "confirmed" &&
          ["delivered", "partially_delivered"].includes(
            order.fulfillmentStatus,
          ) &&
          anyDelivered &&
          everyDeliveredUnitReturned
        ) {
          const [completed] = await transaction
            .update(customerOrder)
            .set({
              fulfillmentStatus: "returned",
              fulfillmentOutcomeReason:
                "All delivered units were received and inspected through return cases.",
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(customerOrder.id, row.orderId))
            .returning({ occurredAt: customerOrder.updatedAt });
          if (completed) {
            await this.audit.append(transaction, {
              actorType: "user",
              actorId: actor.id,
              eventType: "commerce.cod_order_return_completed",
              subjectType: "order",
              subjectId: row.orderId,
              occurredAt: completed.occurredAt,
              reason:
                "All delivered units were received and inspected through return cases.",
              metadata: { returnCaseId },
            });
          }
        }
      }
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.order_return_inspected",
        subjectType: "order_return_case",
        subjectId: returnCaseId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          status: nextStatus,
          sellableQuantity: input.lines.reduce(
            (total, line) =>
              total +
              line.grades
                .filter((grade) => grade.grade === "sellable")
                .reduce((sum, grade) => sum + grade.quantity, 0),
            0,
          ),
        },
      });
    });
    return this.readReturnCase(returnCaseId);
  }

  async recordReturnRefund(
    actor: AccessPrincipal,
    returnCaseId: string,
    input: RecordOrderReturnRefundInput,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    await this.database.db.transaction(async (transaction) => {
      const row = await this.lockReturnCase(transaction, returnCaseId);
      const [priorCommand] = await transaction
        .select()
        .from(orderReturnRefund)
        .where(eq(orderReturnRefund.commandId, input.commandId))
        .limit(1);
      if (priorCommand) {
        if (
          priorCommand.returnCaseId !== returnCaseId ||
          priorCommand.amountBdt !== input.amountBdt ||
          priorCommand.method !== input.method ||
          priorCommand.reference !== (input.reference ?? null) ||
          priorCommand.reason !== input.reason
        ) {
          throw idempotencyConflict("refund");
        }
        return;
      }
      if (row.status !== "refund_pending" || row.origin !== "customer_return") {
        throw returnTransitionConflict(
          "Only an inspected customer return can be refunded.",
        );
      }
      const [order] = await transaction
        .select({
          id: customerOrder.id,
          collectionStatus: customerOrder.collectionStatus,
          collectedAmountBdt: customerOrder.collectedAmountBdt,
        })
        .from(customerOrder)
        .where(eq(customerOrder.id, row.orderId))
        .for("update")
        .limit(1);
      if (!order) throw orderNotFound();
      const [alreadyRefunded] = await transaction
        .select({
          amount: sql<number>`coalesce(sum(${orderReturnRefund.amountBdt}), 0)::bigint`,
        })
        .from(orderReturnRefund)
        .innerJoin(
          orderReturnCase,
          eq(orderReturnCase.id, orderReturnRefund.returnCaseId),
        )
        .where(eq(orderReturnCase.orderId, order.id));
      const availableCollection =
        order.collectionStatus === "uncollected"
          ? 0
          : (order.collectedAmountBdt ?? 0) -
            Number(alreadyRefunded?.amount ?? 0);
      if (
        input.amountBdt > row.maximumRefundAmountBdt ||
        input.amountBdt > availableCollection
      ) {
        throw new ConflictException(
          "The refund exceeds the eligible return value or the amount actually collected from this customer.",
          { errorCode: "ORDER_RETURN_REFUND_LIMIT_EXCEEDED" },
        );
      }

      await transaction.insert(orderReturnRefund).values({
        returnCaseId,
        commandId: input.commandId,
        amountBdt: input.amountBdt,
        method: input.method,
        reference: input.amountBdt > 0 ? input.reference! : null,
        reason: input.reason,
        actorId: actor.id,
      });
      const nextStatus = input.amountBdt > 0 ? "refunded" : "closed";
      const [updated] = await transaction
        .update(orderReturnCase)
        .set({
          status: nextStatus,
          decisionReason: input.reason,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(orderReturnCase.id, returnCaseId))
        .returning({ occurredAt: orderReturnCase.updatedAt });
      if (!updated)
        throw returnTransitionConflict(
          "The return case changed during refund recording.",
        );
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.order_return_refund_recorded",
        subjectType: "order_return_case",
        subjectId: returnCaseId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          amountBdt: input.amountBdt,
          method: input.method,
          status: nextStatus,
          referencePresent: Boolean(input.reference),
        },
      });
    });
    return this.readReturnCase(returnCaseId);
  }

  async getReturnCase(
    actor: AccessPrincipal,
    returnCaseId: string,
  ): Promise<OrderReturnCase> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    return this.readReturnCase(returnCaseId);
  }

  private async readReturnCase(returnCaseId: string): Promise<OrderReturnCase> {
    const [returnCase] = await this.readReturnCases([returnCaseId]);
    if (!returnCase) throw returnCaseNotFound();
    return returnCase;
  }

  private async readReturnCases(
    returnCaseIds: readonly string[],
  ): Promise<OrderReturnCases> {
    if (returnCaseIds.length === 0) return [];
    const headers = await this.database.db
      .select({
        returnCase: orderReturnCase,
        orderReference: customerOrder.reference,
      })
      .from(orderReturnCase)
      .innerJoin(customerOrder, eq(customerOrder.id, orderReturnCase.orderId))
      .where(inArray(orderReturnCase.id, [...returnCaseIds]))
      .orderBy(
        sql`${orderReturnCase.createdAt} DESC`,
        sql`${orderReturnCase.id} DESC`,
      );
    if (headers.length === 0) return [];
    const ids = headers.map(({ returnCase }) => returnCase.id);
    const [lines, refunds] = await Promise.all([
      this.database.db
        .select({
          line: orderReturnCaseLine,
          inspections: orderReturnInspection,
        })
        .from(orderReturnCaseLine)
        .leftJoin(
          orderReturnInspection,
          eq(orderReturnInspection.returnLineId, orderReturnCaseLine.id),
        )
        .where(inArray(orderReturnCaseLine.returnCaseId, ids))
        .orderBy(
          asc(orderReturnCaseLine.returnCaseId),
          asc(orderReturnCaseLine.variantId),
          asc(orderReturnInspection.grade),
        ),
      this.database.db
        .select({
          returnCaseId: orderReturnRefund.returnCaseId,
          amountBdt: orderReturnRefund.amountBdt,
        })
        .from(orderReturnRefund)
        .where(inArray(orderReturnRefund.returnCaseId, ids)),
    ]);
    const grouped = new Map<
      string,
      Map<
        string,
        {
          line: typeof orderReturnCaseLine.$inferSelect;
          inspections: Array<{ grade: string; quantity: number }>;
        }
      >
    >();
    for (const row of lines) {
      let caseLines = grouped.get(row.line.returnCaseId);
      if (!caseLines) {
        caseLines = new Map();
        grouped.set(row.line.returnCaseId, caseLines);
      }
      let entry = caseLines.get(row.line.id);
      if (!entry) {
        entry = { line: row.line, inspections: [] };
        caseLines.set(row.line.id, entry);
      }
      if (row.inspections) {
        entry.inspections.push({
          grade: row.inspections.grade,
          quantity: row.inspections.quantity,
        });
      }
    }
    const refundByCase = new Map(
      refunds.map(
        ({ returnCaseId, amountBdt }) => [returnCaseId, amountBdt] as const,
      ),
    );
    return headers.map(({ returnCase: header, orderReference }) => ({
      id: header.id,
      orderId: header.orderId,
      orderReference,
      origin: header.origin,
      status: header.status,
      reason: header.reason,
      decisionReason: header.decisionReason,
      maximumRefundAmountBdt: header.maximumRefundAmountBdt,
      refundAmountBdt: refundByCase.get(header.id) ?? null,
      createdAt: header.createdAt.toISOString(),
      lines: [...(grouped.get(header.id)?.values() ?? [])].map(
        ({ line, inspections }) => {
          const product = objectValue(line.productSnapshot);
          return {
            variantId: line.variantId,
            productName: textValue(product.productName, "Product"),
            color: textValue(product.color, "Unknown color"),
            sizeLabel: textValue(product.sizeLabel, "Unknown size"),
            requestedQuantity: line.requestedQuantity,
            receivedQuantity: line.receivedQuantity,
            unitPriceBdt: line.unitPriceBdt,
            inspections:
              inspections as OrderReturnCase["lines"][number]["inspections"],
          };
        },
      ),
    }));
  }

  async listReturnCases(
    actor: AccessPrincipal,
    orderId: string,
  ): Promise<OrderReturnCases> {
    await this.authorization.authorize(OrdersPolicy, "manage", actor);
    const [order] = await this.database.db
      .select({ id: customerOrder.id })
      .from(customerOrder)
      .where(eq(customerOrder.id, orderId))
      .limit(1);
    if (!order) throw orderNotFound();
    const cases = await this.database.db
      .select({ id: orderReturnCase.id })
      .from(orderReturnCase)
      .where(eq(orderReturnCase.orderId, orderId))
      .orderBy(
        sql`${orderReturnCase.createdAt} DESC`,
        sql`${orderReturnCase.id} DESC`,
      )
      .limit(100);
    return this.readReturnCases(cases.map(({ id }) => id));
  }

  async importCourierRemittance(
    actor: AccessPrincipal,
    input: ImportCourierRemittanceInput,
  ): Promise<CourierRemittanceBatch> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    const normalizedLines = [...input.lines].sort(byConsignment);
    const fingerprint = requestFingerprint({
      provider: input.provider,
      merchantAccountRef: input.merchantAccountRef,
      providerRemittanceRef: input.providerRemittanceRef,
      receivedAt: input.receivedAt,
      statementTotalBdt: input.statementTotalBdt,
      lines: normalizedLines,
    });
    const contentHash = requestFingerprint({
      provider: input.provider,
      merchantAccountRef: input.merchantAccountRef,
      providerRemittanceRef: input.providerRemittanceRef,
      receivedAt: input.receivedAt,
      statementTotalBdt: input.statementTotalBdt,
      lines: normalizedLines,
    });
    let batchId = "";

    await this.database.db.transaction(async (transaction) => {
      await lockCommand(transaction, input.commandId);
      const [prior] = await transaction
        .select({
          id: courierRemittanceBatch.id,
          requestFingerprint: courierRemittanceBatch.requestFingerprint,
        })
        .from(courierRemittanceBatch)
        .where(eq(courierRemittanceBatch.commandId, input.commandId))
        .limit(1);
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw idempotencyConflict("courier statement import");
        }
        batchId = prior.id;
        return;
      }
      const [duplicateReference] = await transaction
        .select({
          id: courierRemittanceBatch.id,
          statementSha256: courierRemittanceBatch.statementSha256,
        })
        .from(courierRemittanceBatch)
        .where(
          and(
            eq(courierRemittanceBatch.provider, input.provider),
            eq(
              courierRemittanceBatch.merchantAccountRef,
              input.merchantAccountRef,
            ),
            eq(
              courierRemittanceBatch.providerRemittanceRef,
              input.providerRemittanceRef,
            ),
          ),
        )
        .limit(1);
      if (duplicateReference) {
        if (duplicateReference.statementSha256 === contentHash) {
          batchId = duplicateReference.id;
          return;
        }
        throw new ConflictException(
          "This Pathao remittance reference was already imported with different statement data.",
          { errorCode: "COURIER_REMITTANCE_REFERENCE_CONFLICT" },
        );
      }
      const [duplicateContent] = await transaction
        .select({ id: courierRemittanceBatch.id })
        .from(courierRemittanceBatch)
        .where(
          and(
            eq(courierRemittanceBatch.provider, input.provider),
            eq(
              courierRemittanceBatch.merchantAccountRef,
              input.merchantAccountRef,
            ),
            eq(courierRemittanceBatch.statementSha256, contentHash),
          ),
        )
        .limit(1);
      if (duplicateContent) {
        throw new ConflictException(
          "This remittance statement content was already imported.",
          { errorCode: "COURIER_REMITTANCE_DUPLICATE_STATEMENT" },
        );
      }

      const totalLines = sumSafe(
        normalizedLines.map(({ netAmountBdt }) => netAmountBdt),
      );
      const [batch] = await transaction
        .insert(courierRemittanceBatch)
        .values({
          provider: "pathao",
          merchantAccountRef: input.merchantAccountRef,
          providerRemittanceRef: input.providerRemittanceRef,
          statementSha256: contentHash,
          statementTotalBdt: input.statementTotalBdt,
          receivedAt: new Date(input.receivedAt),
          status: "open",
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          createdBy: actor.id,
        })
        .returning({ id: courierRemittanceBatch.id });
      if (!batch)
        throw new Error("Courier remittance batch insert returned no row.");
      batchId = batch.id;

      const lineValues: (typeof courierRemittanceLine.$inferInsert)[] = [];
      for (const [index, line] of normalizedLines.entries()) {
        const bookings = await transaction
          .select({ orderId: pathaoBooking.orderId })
          .from(pathaoBooking)
          .where(
            and(
              eq(pathaoBooking.environment, "live"),
              eq(pathaoBooking.consignmentId, line.consignmentRef),
              eq(pathaoBooking.status, "booked"),
            ),
          )
          .limit(2);
        if (bookings.length > 1) {
          throw new ConflictException(
            "The courier consignment reference matches more than one Order.",
            { errorCode: "COURIER_REMITTANCE_MATCH_AMBIGUOUS" },
          );
        }
        const orderId = bookings[0]?.orderId ?? null;
        let expectedCollectedAmountBdt: number | null = null;
        if (orderId) {
          const [order] = await transaction
            .select({
              collectionStatus: customerOrder.collectionStatus,
              collectedAmountBdt: customerOrder.collectedAmountBdt,
            })
            .from(customerOrder)
            .where(eq(customerOrder.id, orderId))
            .for("update")
            .limit(1);
          if (order?.collectionStatus !== "uncollected") {
            expectedCollectedAmountBdt = order?.collectedAmountBdt ?? null;
          }
        }
        lineValues.push({
          batchId: batch.id,
          lineNumber: index + 1,
          consignmentRef: line.consignmentRef,
          orderId,
          expectedCollectedAmountBdt,
          collectedAmountBdt: line.collectedAmountBdt,
          feeAmountBdt: line.feeAmountBdt,
          netAmountBdt: line.netAmountBdt,
          resolutionStatus: orderId ? "matched" : "pending",
        });
      }
      await transaction.insert(courierRemittanceLine).values(lineValues);
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.courier_remittance_imported",
        subjectType: "courier_remittance_batch",
        subjectId: batch.id,
        reason:
          "A Pathao remittance statement was imported for reconciliation.",
        metadata: {
          lineCount: lineValues.length,
          statementTotalBdt: input.statementTotalBdt,
          lineNetTotalBdt: totalLines,
          contentSha256: contentHash,
        },
      });
    });
    return this.readCourierRemittance(batchId);
  }

  async reconcileCourierRemittance(
    actor: AccessPrincipal,
    batchId: string,
    input: ReconcileCourierRemittanceInput,
  ): Promise<CourierRemittanceBatch> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    const fingerprint = requestFingerprint({ batchId, ...input });
    await this.database.db.transaction(async (transaction) => {
      const [batch] = await transaction
        .select()
        .from(courierRemittanceBatch)
        .where(eq(courierRemittanceBatch.id, batchId))
        .for("update")
        .limit(1);
      if (!batch) throw remittanceNotFound();
      if (
        batch.reconciliationCommandId === input.commandId &&
        batch.reconciliationFingerprint === fingerprint
      ) {
        return;
      }
      if (batch.status !== "open") {
        throw returnTransitionConflict(
          "This remittance statement has already been reconciled.",
        );
      }
      const lines = await transaction
        .select()
        .from(courierRemittanceLine)
        .where(eq(courierRemittanceLine.batchId, batchId))
        .orderBy(asc(courierRemittanceLine.lineNumber));
      if (
        lines.some(
          (line) =>
            line.resolutionStatus === "pending" ||
            (line.resolutionStatus === "matched" &&
              (line.orderId === null ||
                line.expectedCollectedAmountBdt === null)),
        )
      ) {
        throw new ConflictException(
          "Every AARAJ remittance line must match a booked Pathao consignment and a staff-recorded customer collection. Unmatched rows must be explicitly accepted as external.",
          { errorCode: "COURIER_REMITTANCE_UNMATCHED_LINES" },
        );
      }
      const lineNetTotal = sumSafe(lines.map((line) => line.netAmountBdt));
      const hasDiscrepancy =
        lineNetTotal !== batch.statementTotalBdt ||
        lines.some(
          (line) => line.expectedCollectedAmountBdt !== line.collectedAmountBdt,
        );
      if (hasDiscrepancy && !input.acceptedDiscrepancy) {
        throw new ConflictException(
          "The statement contains a collection or total variance. Finance must explicitly accept the recorded variance with a reason.",
          { errorCode: "COURIER_REMITTANCE_VARIANCE_REQUIRES_REVIEW" },
        );
      }
      const [updated] = await transaction
        .update(courierRemittanceBatch)
        .set({
          status: "reconciled",
          reconciliationCommandId: input.commandId,
          reconciliationFingerprint: fingerprint,
          reconciliationReason: input.reason,
          reconciledBy: actor.id,
          reconciledAt: sql`clock_timestamp()`,
        })
        .where(eq(courierRemittanceBatch.id, batchId))
        .returning({ occurredAt: courierRemittanceBatch.reconciledAt });
      if (!updated?.occurredAt)
        throw returnTransitionConflict(
          "The remittance batch changed during reconciliation.",
        );
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.courier_remittance_reconciled",
        subjectType: "courier_remittance_batch",
        subjectId: batchId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          lineCount: lines.length,
          lineNetTotalBdt: lineNetTotal,
          statementTotalBdt: batch.statementTotalBdt,
          discrepancyAccepted: hasDiscrepancy,
          externalLineCount: lines.filter(
            (line) => line.resolutionStatus === "external",
          ).length,
        },
      });
    });
    return this.readCourierRemittance(batchId);
  }

  async getCourierRemittance(
    actor: AccessPrincipal,
    batchId: string,
  ): Promise<CourierRemittanceBatch> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    return this.readCourierRemittance(batchId);
  }

  private async readCourierRemittance(
    batchId: string,
  ): Promise<CourierRemittanceBatch> {
    const [batch] = await this.database.db
      .select()
      .from(courierRemittanceBatch)
      .where(eq(courierRemittanceBatch.id, batchId))
      .limit(1);
    if (!batch) throw remittanceNotFound();
    const [result] = await this.mapCourierRemittances([batch]);
    if (!result) throw remittanceNotFound();
    return result;
  }

  private async mapCourierRemittances(
    batches: Array<typeof courierRemittanceBatch.$inferSelect>,
  ): Promise<CourierRemittanceBatches> {
    if (batches.length === 0) return [];
    const batchIds = batches.map(({ id }) => id);
    const lineRows = await this.database.db
      .select({
        batchId: courierRemittanceLine.batchId,
        line: courierRemittanceLine,
        orderReference: customerOrder.reference,
      })
      .from(courierRemittanceLine)
      .leftJoin(
        customerOrder,
        eq(customerOrder.id, courierRemittanceLine.orderId),
      )
      .where(inArray(courierRemittanceLine.batchId, batchIds))
      .orderBy(
        asc(courierRemittanceLine.batchId),
        asc(courierRemittanceLine.lineNumber),
      );
    const linesByBatch = new Map<string, typeof lineRows>();
    for (const row of lineRows) {
      const rows = linesByBatch.get(row.batchId) ?? [];
      rows.push(row);
      linesByBatch.set(row.batchId, rows);
    }
    const confirmations = await this.database.db
      .select({
        confirmation: courierSettlementConfirmation,
        journal: courierSettlementJournal,
      })
      .from(courierSettlementConfirmation)
      .innerJoin(
        courierSettlementJournal,
        eq(
          courierSettlementJournal.confirmationId,
          courierSettlementConfirmation.id,
        ),
      )
      .where(inArray(courierSettlementConfirmation.batchId, batchIds));
    const confirmationByBatch = new Map(
      confirmations.map((row) => [row.confirmation.batchId, row]),
    );
    const journalIds = confirmations.map(({ journal }) => journal.id);
    const journalRows =
      journalIds.length === 0
        ? []
        : await this.database.db
            .select({
              journalId: courierSettlementJournalEntry.journalId,
              accountKey: courierSettlementJournalEntry.accountKey,
              debitBdt: courierSettlementJournalEntry.debitBdt,
              creditBdt: courierSettlementJournalEntry.creditBdt,
            })
            .from(courierSettlementJournalEntry)
            .where(inArray(courierSettlementJournalEntry.journalId, journalIds))
            .orderBy(
              asc(courierSettlementJournalEntry.journalId),
              asc(courierSettlementJournalEntry.lineNumber),
            );
    const entriesByJournal = new Map<string, typeof journalRows>();
    for (const entry of journalRows) {
      const rows = entriesByJournal.get(entry.journalId) ?? [];
      rows.push(entry);
      entriesByJournal.set(entry.journalId, rows);
    }
    return batches.map((batch) => {
      const lines = linesByBatch.get(batch.id) ?? [];
      const lineNetTotal = sumSafe(lines.map(({ line }) => line.netAmountBdt));
      const confirmation = confirmationByBatch.get(batch.id);
      const entries = confirmation
        ? (entriesByJournal.get(confirmation.journal.id) ?? [])
        : [];
      return {
        id: batch.id,
        provider: "pathao" as const,
        merchantAccountRef: batch.merchantAccountRef,
        providerRemittanceRef: batch.providerRemittanceRef,
        receivedAt: batch.receivedAt.toISOString(),
        statementSha256: batch.statementSha256,
        statementTotalBdt: batch.statementTotalBdt,
        linesTotalBdt: lineNetTotal,
        totalVarianceBdt: safeDifference(lineNetTotal, batch.statementTotalBdt),
        status: batch.status,
        reconciliationReason: batch.reconciliationReason,
        bankConfirmation: confirmation
          ? {
              bankReference: confirmation.confirmation.bankReference,
              bankAmountBdt: confirmation.confirmation.bankAmountBdt,
              confirmedAt: confirmation.confirmation.confirmedAt.toISOString(),
              journalId: confirmation.journal.id,
              varianceBdt: confirmation.journal.varianceBdt,
              entries: entries.map(({ accountKey, debitBdt, creditBdt }) => ({
                accountKey,
                debitBdt,
                creditBdt,
              })),
            }
          : null,
        createdAt: batch.createdAt.toISOString(),
        lines: lines.map(({ line, orderReference }) => ({
          id: line.id,
          consignmentRef: line.consignmentRef,
          orderId: line.orderId,
          orderReference,
          expectedCollectedAmountBdt: line.expectedCollectedAmountBdt,
          collectedAmountBdt: line.collectedAmountBdt,
          feeAmountBdt: line.feeAmountBdt,
          netAmountBdt: line.netAmountBdt,
          resolutionStatus: line.resolutionStatus,
          resolutionReason: line.resolutionReason,
          varianceBdt:
            line.expectedCollectedAmountBdt === null
              ? null
              : safeDifference(
                  line.collectedAmountBdt,
                  line.expectedCollectedAmountBdt,
                ),
        })),
      };
    });
  }

  async confirmCourierSettlement(
    actor: AccessPrincipal,
    batchId: string,
    input: ConfirmCourierSettlementInput,
  ): Promise<CourierRemittanceBatch> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    const fingerprint = requestFingerprint({ batchId, ...input });
    try {
      await this.database.db.transaction(async (transaction) => {
        const [batch] = await transaction
          .select()
          .from(courierRemittanceBatch)
          .where(eq(courierRemittanceBatch.id, batchId))
          .for("update")
          .limit(1);
        if (!batch) throw remittanceNotFound();
        await lockCommand(transaction, input.commandId);
        const [existing] = await transaction
          .select()
          .from(courierSettlementConfirmation)
          .where(eq(courierSettlementConfirmation.batchId, batchId))
          .limit(1);
        if (existing) {
          if (
            existing.commandId !== input.commandId ||
            existing.requestFingerprint !== fingerprint
          )
            throw idempotencyConflict("bank settlement confirmation");
          return;
        }
        const [usedBankReference] = await transaction
          .select({ batchId: courierSettlementConfirmation.batchId })
          .from(courierSettlementConfirmation)
          .where(
            eq(
              courierSettlementConfirmation.bankReference,
              input.bankReference,
            ),
          )
          .limit(1);
        if (usedBankReference) {
          throw new ConflictException(
            "This bank transaction reference was already used for another courier settlement.",
            { errorCode: "COURIER_BANK_REFERENCE_ALREADY_USED" },
          );
        }
        if (batch.status !== "reconciled") {
          throw returnTransitionConflict(
            "Reconcile the courier statement before confirming bank settlement.",
          );
        }

        const lines = await transaction
          .select()
          .from(courierRemittanceLine)
          .where(eq(courierRemittanceLine.batchId, batchId))
          .orderBy(asc(courierRemittanceLine.lineNumber));
        const totalCollectedBdt = sumSafe(
          lines.map((line) => line.collectedAmountBdt),
        );
        const totalFeesBdt = sumSafe(lines.map((line) => line.feeAmountBdt));
        const totalNetBdt = sumSafe(lines.map((line) => line.netAmountBdt));
        const varianceBdt = safeDifference(input.bankAmountBdt, totalNetBdt);
        if (totalCollectedBdt - totalFeesBdt !== totalNetBdt) {
          throw returnTransitionConflict(
            "The statement totals do not balance; correct the imported statement before posting.",
          );
        }

        const [savedConfirmation] = await transaction
          .insert(courierSettlementConfirmation)
          .values({
            batchId,
            commandId: input.commandId,
            requestFingerprint: fingerprint,
            bankReference: input.bankReference,
            bankAmountBdt: input.bankAmountBdt,
            reason: input.reason,
            confirmedBy: actor.id,
          })
          .returning();
        if (!savedConfirmation)
          throw new Error("Bank settlement confirmation was not saved.");

        const [journal] = await transaction
          .insert(courierSettlementJournal)
          .values({
            batchId,
            confirmationId: savedConfirmation.id,
            status: "draft",
            postedBy: actor.id,
            bankReference: input.bankReference,
            bankAmountBdt: input.bankAmountBdt,
            totalCollectedBdt,
            totalFeesBdt,
            totalNetBdt,
            varianceBdt,
          })
          .returning({ id: courierSettlementJournal.id });
        if (!journal)
          throw new Error("Settlement journal draft was not created.");

        const entries: Array<{
          journalId: string;
          lineNumber: number;
          accountKey:
            | "bank_cash"
            | "courier_fee_expense"
            | "cod_settlement_clearing"
            | "settlement_variance_suspense";
          debitBdt: number;
          creditBdt: number;
          memo: string;
          sourceLineId?: string;
        }> = [];
        let lineNumber = 1;
        if (input.bankAmountBdt > 0)
          entries.push({
            journalId: journal.id,
            lineNumber: lineNumber++,
            accountKey: "bank_cash",
            debitBdt: input.bankAmountBdt,
            creditBdt: 0,
            memo: "Bank deposit confirmed by finance.",
          });
        for (const line of lines) {
          if (line.feeAmountBdt > 0)
            entries.push({
              journalId: journal.id,
              lineNumber: lineNumber++,
              accountKey: "courier_fee_expense",
              debitBdt: line.feeAmountBdt,
              creditBdt: 0,
              memo: "Courier fee from the reconciled statement.",
              sourceLineId: line.id,
            });
          if (line.collectedAmountBdt > 0)
            entries.push({
              journalId: journal.id,
              lineNumber: lineNumber++,
              accountKey: "cod_settlement_clearing",
              debitBdt: 0,
              creditBdt: line.collectedAmountBdt,
              memo: "COD collection reported by the reconciled courier statement.",
              sourceLineId: line.id,
            });
        }
        if (varianceBdt > 0)
          entries.push({
            journalId: journal.id,
            lineNumber: lineNumber++,
            accountKey: "settlement_variance_suspense",
            debitBdt: 0,
            creditBdt: varianceBdt,
            memo: "Deposit above statement net; held in settlement variance suspense.",
          });
        if (varianceBdt < 0)
          entries.push({
            journalId: journal.id,
            lineNumber: lineNumber++,
            accountKey: "settlement_variance_suspense",
            debitBdt: -varianceBdt,
            creditBdt: 0,
            memo: "Deposit below statement net; held in settlement variance suspense.",
          });
        if (entries.length === 0)
          throw returnTransitionConflict(
            "A zero-value statement cannot be posted as a bank settlement.",
          );
        await transaction.insert(courierSettlementJournalEntry).values(entries);
        const [posted] = await transaction
          .update(courierSettlementJournal)
          .set({ status: "posted", postedAt: sql`clock_timestamp()` })
          .where(eq(courierSettlementJournal.id, journal.id))
          .returning({ postedAt: courierSettlementJournal.postedAt });
        if (!posted?.postedAt)
          throw new Error("Settlement journal did not post.");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "commerce.courier_bank_settlement_confirmed",
          subjectType: "courier_remittance_batch",
          subjectId: batchId,
          occurredAt: savedConfirmation.confirmedAt,
          reason: input.reason,
          metadata: {
            bankReference: input.bankReference,
            bankAmountBdt: input.bankAmountBdt,
            journalId: journal.id,
            varianceBdt,
          },
        });
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "commerce.courier_settlement_journal_posted",
          subjectType: "courier_settlement_journal",
          subjectId: journal.id,
          occurredAt: posted.postedAt,
          reason:
            "Balanced COD settlement journal posted from bank-confirmed remittance evidence.",
          metadata: {
            batchId,
            debitTotalBdt: entries
              .reduce((sum, entry) => sum + BigInt(entry.debitBdt), 0n)
              .toString(),
            creditTotalBdt: entries
              .reduce((sum, entry) => sum + BigInt(entry.creditBdt), 0n)
              .toString(),
          },
        });
      });
    } catch (error) {
      if (
        postgresConstraint(error) ===
        "courier_settlement_confirmation_bank_reference_uidx"
      ) {
        throw new ConflictException(
          "This bank transaction reference was already used for another courier settlement.",
          { errorCode: "COURIER_BANK_REFERENCE_ALREADY_USED" },
        );
      }
      throw error;
    }
    return this.readCourierRemittance(batchId);
  }

  async listCourierRemittances(
    actor: AccessPrincipal,
  ): Promise<CourierRemittanceBatches> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    const batches = await this.database.db
      .select()
      .from(courierRemittanceBatch)
      .orderBy(
        sql`${courierRemittanceBatch.createdAt} DESC`,
        sql`${courierRemittanceBatch.id} DESC`,
      )
      .limit(100);
    return this.mapCourierRemittances(batches);
  }

  async resolveCourierRemittanceLine(
    actor: AccessPrincipal,
    batchId: string,
    lineId: string,
    input: ResolveCourierRemittanceLineInput,
  ): Promise<CourierRemittanceBatch> {
    await this.authorization.authorize(OrdersFinancePolicy, "manage", actor);
    const fingerprint = requestFingerprint({ batchId, lineId, ...input });
    await this.database.db.transaction(async (transaction) => {
      const [batch] = await transaction
        .select({
          id: courierRemittanceBatch.id,
          status: courierRemittanceBatch.status,
        })
        .from(courierRemittanceBatch)
        .where(eq(courierRemittanceBatch.id, batchId))
        .for("update")
        .limit(1);
      if (!batch) throw remittanceNotFound();
      await lockCommand(transaction, input.commandId);
      const [line] = await transaction
        .select()
        .from(courierRemittanceLine)
        .where(
          and(
            eq(courierRemittanceLine.id, lineId),
            eq(courierRemittanceLine.batchId, batchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!line) throw remittanceNotFound();
      if (
        line.resolutionCommandId === input.commandId &&
        line.resolutionFingerprint === fingerprint
      )
        return;
      if (
        batch.status !== "open" ||
        line.resolutionStatus !== "pending" ||
        line.orderId
      ) {
        throw returnTransitionConflict(
          "Only an unresolved external statement line can be accepted while its batch is open.",
        );
      }
      const [updated] = await transaction
        .update(courierRemittanceLine)
        .set({
          resolutionStatus: "external",
          resolutionReason: input.reason,
          resolutionCommandId: input.commandId,
          resolutionFingerprint: fingerprint,
          resolvedBy: actor.id,
          resolvedAt: sql`clock_timestamp()`,
        })
        .where(eq(courierRemittanceLine.id, lineId))
        .returning({ occurredAt: courierRemittanceLine.resolvedAt });
      if (!updated?.occurredAt)
        throw returnTransitionConflict(
          "The remittance line changed during review.",
        );
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "commerce.courier_remittance_external_line_accepted",
        subjectType: "courier_remittance_batch",
        subjectId: batchId,
        occurredAt: updated.occurredAt,
        reason: input.reason,
        metadata: {
          lineId,
          consignmentRef: line.consignmentRef,
          netAmountBdt: line.netAmountBdt,
        },
      });
    });
    return this.readCourierRemittance(batchId);
  }

  private async lockReturnCase(
    transaction: AuditTransaction,
    returnCaseId: string,
  ) {
    const [row] = await transaction
      .select()
      .from(orderReturnCase)
      .where(eq(orderReturnCase.id, returnCaseId))
      .for("update")
      .limit(1);
    if (!row) throw returnCaseNotFound();
    return row;
  }
}

function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withoutOrderAddress(order: Order): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...order };
  delete snapshot.address;
  return snapshot;
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function lockCommand(
  transaction: AuditTransaction,
  commandId: string,
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${commandId}, 0))`,
  );
}

function assertExactVariants(
  expected: readonly string[],
  actual: readonly string[],
) {
  const sort = (values: readonly string[]) => [...values].sort();
  if (JSON.stringify(sort(expected)) !== JSON.stringify(sort(actual))) {
    throw new ConflictException(
      "The request must contain every line on the return case exactly once.",
      { errorCode: "ORDER_RETURN_LINES_MISMATCH" },
    );
  }
}

function sumSafe(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total < 0n || total > MAX_SAFE_BDT) {
    throw new ConflictException(
      "The remittance amount exceeds the supported limit.",
    );
  }
  return Number(total);
}

function safeDifference(left: number, right: number): number {
  const difference = BigInt(left) - BigInt(right);
  if (difference < -MAX_SAFE_BDT || difference > MAX_SAFE_BDT) {
    throw new ConflictException(
      "The remittance variance exceeds the supported limit.",
    );
  }
  return Number(difference);
}

function byVariant<T extends { variantId: string }>(a: T, b: T) {
  return a.variantId.localeCompare(b.variantId);
}

function byConsignment<T extends { consignmentRef: string }>(a: T, b: T) {
  return a.consignmentRef.localeCompare(b.consignmentRef);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function orderNotFound() {
  return new NotFoundException("Order not found.", {
    errorCode: "ORDER_NOT_FOUND",
  });
}

function returnCaseNotFound() {
  return new NotFoundException("Return case not found.", {
    errorCode: "ORDER_RETURN_CASE_NOT_FOUND",
  });
}

function remittanceNotFound() {
  return new NotFoundException("Courier remittance batch not found.", {
    errorCode: "COURIER_REMITTANCE_NOT_FOUND",
  });
}

function returnQuantityConflict() {
  return new ConflictException(
    "Return quantities cannot exceed the verified delivered or not-yet-delivered units for this Order.",
    { errorCode: "ORDER_RETURN_QUANTITY_LIMIT_EXCEEDED" },
  );
}

function returnTransitionConflict(message: string) {
  return new ConflictException(message, {
    errorCode: "ORDER_RETURN_TRANSITION_CONFLICT",
  });
}

function idempotencyConflict(operation: string) {
  return new ConflictException(
    `This command ID was already used with different ${operation} details.`,
    { errorCode: "IDEMPOTENCY_KEY_REUSED" },
  );
}

function postgresConstraint(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      typeof current.constraint === "string"
    )
      return current.constraint;
    current = "cause" in current ? current.cause : null;
  }
  return undefined;
}

import { z } from "zod";

const UuidSchema = z.uuid();
const ReasonSchema = z.string().trim().min(3).max(500);
const MoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const OrderReturnOriginSchema = z.enum([
  "customer_return",
  "courier_rts",
  "doorstep_refusal",
]);

export const CreateOrderReturnInputSchema = z.strictObject({
  commandId: UuidSchema,
  origin: OrderReturnOriginSchema,
  reason: ReasonSchema,
  lines: z
    .array(
      z.strictObject({
        variantId: UuidSchema,
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (lines) =>
        new Set(lines.map(({ variantId }) => variantId)).size === lines.length,
      "Each variant can appear only once.",
    ),
});
export type CreateOrderReturnInput = z.infer<
  typeof CreateOrderReturnInputSchema
>;

export const DecideOrderReturnInputSchema = z.strictObject({
  commandId: UuidSchema,
  decision: z.enum(["authorize", "reject"]),
  reason: ReasonSchema,
});
export type DecideOrderReturnInput = z.infer<
  typeof DecideOrderReturnInputSchema
>;

export const ReceiveOrderReturnInputSchema = z.strictObject({
  commandId: UuidSchema,
  reason: ReasonSchema,
  lines: z
    .array(
      z.strictObject({
        variantId: UuidSchema,
        quantityReceived: z.number().int().min(0).max(10),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (lines) =>
        new Set(lines.map(({ variantId }) => variantId)).size === lines.length,
      "Each variant can appear only once.",
    ),
});
export type ReceiveOrderReturnInput = z.infer<
  typeof ReceiveOrderReturnInputSchema
>;

export const ReturnInspectionGradeSchema = z.enum([
  "sellable",
  "repairable",
  "damaged",
  "fraud_review",
]);

export const InspectOrderReturnInputSchema = z.strictObject({
  commandId: UuidSchema,
  reason: ReasonSchema,
  lines: z
    .array(
      z.strictObject({
        variantId: UuidSchema,
        grades: z
          .array(
            z.strictObject({
              grade: ReturnInspectionGradeSchema,
              quantity: z.number().int().min(1).max(10),
            }),
          )
          .max(4)
          .refine(
            (grades) =>
              new Set(grades.map(({ grade }) => grade)).size === grades.length,
            "Each inspection grade can appear only once per variant.",
          ),
        restockCommandId: UuidSchema.optional(),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (lines) =>
        new Set(lines.map(({ variantId }) => variantId)).size === lines.length,
      "Each variant can appear only once.",
    ),
});
export type InspectOrderReturnInput = z.infer<
  typeof InspectOrderReturnInputSchema
>;

export const RecordOrderReturnRefundInputSchema = z
  .strictObject({
    commandId: UuidSchema,
    amountBdt: MoneySchema,
    method: z.enum(["bank_transfer", "mobile_money", "cash"]),
    reference: z.string().trim().min(1).max(160).optional(),
    reason: ReasonSchema,
  })
  .superRefine((value, context) => {
    if (value.amountBdt > 0 && !value.reference) {
      context.addIssue({
        code: "custom",
        path: ["reference"],
        message:
          "A transfer or cash receipt reference is required for a refund.",
      });
    }
  });
export type RecordOrderReturnRefundInput = z.infer<
  typeof RecordOrderReturnRefundInputSchema
>;

export const OrderReturnCaseSchema = z.strictObject({
  id: UuidSchema,
  orderId: UuidSchema,
  orderReference: z.string().min(1).max(32),
  origin: OrderReturnOriginSchema,
  status: z.enum([
    "requested",
    "authorized",
    "rejected",
    "received",
    "inspected",
    "refund_pending",
    "refunded",
    "closed",
  ]),
  reason: ReasonSchema,
  decisionReason: ReasonSchema.nullable(),
  maximumRefundAmountBdt: MoneySchema,
  refundAmountBdt: MoneySchema.nullable(),
  createdAt: z.iso.datetime(),
  lines: z.array(
    z.strictObject({
      variantId: UuidSchema,
      productName: z.string().min(1).max(160),
      color: z.string().min(1).max(80),
      sizeLabel: z.string().min(1).max(40),
      requestedQuantity: z.number().int().min(1).max(10),
      receivedQuantity: z.number().int().min(0).max(10),
      unitPriceBdt: MoneySchema,
      inspections: z.array(
        z.strictObject({
          grade: ReturnInspectionGradeSchema,
          quantity: z.number().int().min(1).max(10),
        }),
      ),
    }),
  ),
});
export type OrderReturnCase = z.infer<typeof OrderReturnCaseSchema>;

export const OrderReturnCasesSchema = z.array(OrderReturnCaseSchema).max(100);
export type OrderReturnCases = z.infer<typeof OrderReturnCasesSchema>;

export const ImportCourierRemittanceInputSchema = z
  .strictObject({
    commandId: UuidSchema,
    provider: z.literal("pathao"),
    merchantAccountRef: z.string().trim().min(1).max(120),
    providerRemittanceRef: z.string().trim().min(1).max(160),
    receivedAt: z.iso.datetime({ offset: true }),
    statementTotalBdt: MoneySchema,
    lines: z
      .array(
        z.strictObject({
          consignmentRef: z.string().trim().min(1).max(120),
          collectedAmountBdt: MoneySchema,
          feeAmountBdt: MoneySchema,
          netAmountBdt: MoneySchema,
        }),
      )
      .min(1)
      .max(5000)
      .refine(
        (lines) =>
          new Set(lines.map(({ consignmentRef }) => consignmentRef)).size ===
          lines.length,
        "A consignment can appear only once in a remittance statement.",
      ),
  })
  .superRefine((value, context) => {
    value.lines.forEach((line, index) => {
      if (line.netAmountBdt !== line.collectedAmountBdt - line.feeAmountBdt) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "netAmountBdt"],
          message:
            "Net settlement must equal collected amount less stated fees.",
        });
      }
    });
  });
export type ImportCourierRemittanceInput = z.infer<
  typeof ImportCourierRemittanceInputSchema
>;

export const ReconcileCourierRemittanceInputSchema = z.strictObject({
  commandId: UuidSchema,
  reason: ReasonSchema,
  acceptedDiscrepancy: z.boolean(),
});
export type ReconcileCourierRemittanceInput = z.infer<
  typeof ReconcileCourierRemittanceInputSchema
>;

export const ConfirmCourierSettlementInputSchema = z.strictObject({
  commandId: UuidSchema,
  bankReference: z.string().trim().min(1).max(160),
  bankAmountBdt: MoneySchema,
  reason: ReasonSchema,
});
export type ConfirmCourierSettlementInput = z.infer<
  typeof ConfirmCourierSettlementInputSchema
>;

export const CourierRemittanceLineSchema = z.strictObject({
  id: UuidSchema,
  consignmentRef: z.string().min(1).max(120),
  orderId: UuidSchema.nullable(),
  orderReference: z.string().min(1).max(32).nullable(),
  expectedCollectedAmountBdt: MoneySchema.nullable(),
  collectedAmountBdt: MoneySchema,
  feeAmountBdt: MoneySchema,
  netAmountBdt: MoneySchema,
  varianceBdt: z.number().int().nullable(),
  resolutionStatus: z.enum(["matched", "pending", "external"]),
  resolutionReason: ReasonSchema.nullable(),
});

export const ResolveCourierRemittanceLineInputSchema = z.strictObject({
  commandId: UuidSchema,
  disposition: z.literal("external"),
  reason: ReasonSchema,
});
export type ResolveCourierRemittanceLineInput = z.infer<
  typeof ResolveCourierRemittanceLineInputSchema
>;

export const CourierRemittanceBatchSchema = z.strictObject({
  id: UuidSchema,
  provider: z.literal("pathao"),
  merchantAccountRef: z.string().min(1).max(120),
  providerRemittanceRef: z.string().min(1).max(160),
  receivedAt: z.iso.datetime(),
  statementSha256: z.hex().length(64),
  statementTotalBdt: MoneySchema,
  linesTotalBdt: MoneySchema,
  totalVarianceBdt: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["open", "reconciled"]),
  reconciliationReason: ReasonSchema.nullable(),
  bankConfirmation: z
    .strictObject({
      bankReference: z.string().min(1).max(160),
      bankAmountBdt: MoneySchema,
      confirmedAt: z.iso.datetime(),
      journalId: UuidSchema,
      varianceBdt: z
        .number()
        .int()
        .min(-Number.MAX_SAFE_INTEGER)
        .max(Number.MAX_SAFE_INTEGER),
      entries: z.array(
        z.strictObject({
          accountKey: z.enum([
            "bank_cash",
            "courier_fee_expense",
            "cod_settlement_clearing",
            "settlement_variance_suspense",
          ]),
          debitBdt: MoneySchema,
          creditBdt: MoneySchema,
        }),
      ),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  lines: z.array(CourierRemittanceLineSchema),
});
export type CourierRemittanceBatch = z.infer<
  typeof CourierRemittanceBatchSchema
>;

export const CourierRemittanceBatchesSchema = z
  .array(CourierRemittanceBatchSchema)
  .max(100);
export type CourierRemittanceBatches = z.infer<
  typeof CourierRemittanceBatchesSchema
>;

export const OrderNotificationSchema = z.strictObject({
  id: UuidSchema,
  orderId: UuidSchema,
  orderReference: z.string().min(1).max(32),
  eventKey: z.enum([
    "order_received",
    "order_confirmed",
    "order_cancelled",
    "order_dispatched",
    "order_partially_delivered",
    "order_delivered",
    "order_delivery_issue",
    "order_returned",
  ]),
  status: z.enum([
    "pending",
    "sending",
    "unknown",
    "accepted",
    "delivered",
    "failed",
    "suppressed",
  ]),
  attemptCount: z.number().int().nonnegative(),
  providerMessageSid: z
    .string()
    .regex(/^SM[0-9a-fA-F]{32}$/)
    .nullable(),
  providerStatus: z.string().max(40).nullable(),
  lastErrorCode: z
    .string()
    .regex(/^[A-Z0-9_]{1,80}$/)
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OrderNotification = z.infer<typeof OrderNotificationSchema>;
export const OrderNotificationsSchema = z
  .array(OrderNotificationSchema)
  .max(500);
export type OrderNotifications = z.infer<typeof OrderNotificationsSchema>;

export const ResolveOrderNotificationInputSchema = z.strictObject({
  commandId: UuidSchema,
  resolution: z.enum(["confirmed_sent", "confirmed_not_sent"]),
  reason: ReasonSchema,
});
export type ResolveOrderNotificationInput = z.infer<
  typeof ResolveOrderNotificationInputSchema
>;

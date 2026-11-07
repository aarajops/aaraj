import { z } from "zod";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";
import { OrderReferenceSchema } from "../orders/order-reference.js";
import {
  OrderFulfillmentStatusSchema,
  OrderStatusSchema,
} from "../orders/index.js";

const OptionalCustomerSearchSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(2).max(254).optional(),
);

export const CustomerDirectoryQuerySchema = OffsetPaginationQuerySchema.extend({
  search: OptionalCustomerSearchSchema,
});
export type CustomerDirectoryQuery = z.infer<
  typeof CustomerDirectoryQuerySchema
>;

export const CustomerOrdersQuerySchema = OffsetPaginationQuerySchema;
export type CustomerOrdersQuery = z.infer<typeof CustomerOrdersQuerySchema>;

export const CustomerDirectoryIdSchema = z
  .string()
  .min(9)
  .max(137)
  .regex(
    /^(account_[A-Za-z0-9_-]{1,128}|guest_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );

export const ManagedCustomerSchema = z.strictObject({
  id: CustomerDirectoryIdSchema,
  identityType: z.enum(["account", "guest_order"]),
  name: z.string().min(2).max(255),
  email: z.email().max(254).nullable(),
  latestRecipientName: z.string().min(2).max(120),
  latestRecipientPhone: z.string().regex(/^\+8801[3-9]\d{8}$/),
  orderCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lastOrderAt: z.iso.datetime(),
  latestOrder: z.strictObject({
    id: z.uuid(),
    reference: OrderReferenceSchema,
    status: OrderStatusSchema,
    createdAt: z.iso.datetime(),
  }),
});
export type ManagedCustomer = z.infer<typeof ManagedCustomerSchema>;

export const ManagedCustomerDirectorySchema = z.strictObject({
  rows: z.array(ManagedCustomerSchema),
  ...OffsetPaginationMetadataSchema.shape,
});
export type ManagedCustomerDirectory = z.infer<
  typeof ManagedCustomerDirectorySchema
>;

export const ManagedCustomerOrderSchema = z.strictObject({
  id: z.uuid(),
  reference: OrderReferenceSchema,
  status: OrderStatusSchema,
  fulfillmentStatus: OrderFulfillmentStatusSchema,
  totalBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime(),
});
export type ManagedCustomerOrder = z.infer<typeof ManagedCustomerOrderSchema>;

export const ManagedCustomerOrdersPageSchema = z.strictObject({
  rows: z.array(ManagedCustomerOrderSchema),
  ...OffsetPaginationMetadataSchema.shape,
});
export type ManagedCustomerOrdersPage = z.infer<
  typeof ManagedCustomerOrdersPageSchema
>;

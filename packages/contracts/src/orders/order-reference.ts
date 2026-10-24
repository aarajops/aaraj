import { z } from "zod";

export const OrderReferenceSchema = z
  .string()
  .regex(/^(?:AA-[0-9A-F]{12}|ORD-[0-9]{3}-[0-9]{5})$/);

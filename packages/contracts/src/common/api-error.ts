import { z } from "zod";

/** Nest's HTTP exception response shape, including Nest's optional errorCode. */
export const ApiErrorResponseSchema = z.looseObject({
  statusCode: z.number().int().min(400).max(599),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
  errorCode: z.string().min(1).optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

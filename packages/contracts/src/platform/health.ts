import { z } from "zod";

export const CONTRACT_VERSION = "0.0.1";

export const HealthCheckResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  service: z.string(),
  timestamp: z.iso.datetime(),
  version: z.string(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

import { z } from "zod";

export const AuditEventQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  eventType: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{0,99}$/)
    .optional(),
  actorId: z.string().min(1).max(128).optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type AuditEventQuery = z.infer<typeof AuditEventQuerySchema>;

export const AuditEventSchema = z.strictObject({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actorType: z.enum(["user", "service", "anonymous"]),
  actorId: z.string().nullable(),
  eventType: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  requestId: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditEventPageSchema = z.strictObject({
  events: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AuditEventPage = z.infer<typeof AuditEventPageSchema>;

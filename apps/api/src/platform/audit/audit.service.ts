import { Injectable } from "@nestjs/common";
import { auditEvent } from "./audit-schema.js";
import type { AuditTransaction } from "./audit.types.js";

export type AuditActorType = "user" | "service" | "anonymous";

export interface AuditEventInput {
  actorType: AuditActorType;
  actorId?: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  requestId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async append(
    transaction: AuditTransaction,
    event: AuditEventInput,
  ): Promise<string> {
    const [record] = await transaction
      .insert(auditEvent)
      .values({
        actorType: event.actorType,
        actorId: event.actorId,
        eventType: event.eventType,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        requestId: event.requestId,
        reason: event.reason,
        metadata: event.metadata ?? {},
      })
      .returning({ id: auditEvent.id });

    if (!record) {
      throw new Error("Audit event insert did not return an identifier.");
    }

    return record.id;
  }
}

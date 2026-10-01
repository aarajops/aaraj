import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuditEventPage, AuditEventQuery } from "@aaraj/contracts";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDrizzleDatabase } from "../database/database-client.js";
import { DatabaseService } from "../database/database.service.js";
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

async function insertAuditEvent(
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

  if (!record)
    throw new Error("Audit event insert did not return an identifier.");
  return record.id;
}

export function recordAuditEvent(event: AuditEventInput): Promise<string> {
  return getDrizzleDatabase().transaction((transaction) =>
    insertAuditEvent(transaction, event),
  );
}

interface AuditCursor {
  occurredAt: string;
  id: string;
}

function decodeCursor(value: string): AuditCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("occurredAt" in decoded) ||
      typeof decoded.occurredAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
        decoded.occurredAt,
      ) ||
      !("id" in decoded) ||
      typeof decoded.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        decoded.id,
      )
    ) {
      throw new Error("invalid cursor");
    }
    if (!Number.isFinite(new Date(decoded.occurredAt).getTime()))
      throw new Error("invalid cursor");
    return { occurredAt: decoded.occurredAt, id: decoded.id };
  } catch {
    throw new BadRequestException("The audit cursor is invalid.");
  }
}

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ occurredAt, id })).toString("base64url");
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  append(
    transaction: AuditTransaction,
    event: AuditEventInput,
  ): Promise<string> {
    return insertAuditEvent(transaction, event);
  }

  async list(query: AuditEventQuery, actorId: string): Promise<AuditEventPage> {
    return this.database.db.transaction(async (transaction) => {
      const predicates = [];
      if (query.eventType)
        predicates.push(eq(auditEvent.eventType, query.eventType));
      if (query.actorId) predicates.push(eq(auditEvent.actorId, query.actorId));
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        predicates.push(
          or(
            sql`${auditEvent.occurredAt} < ${cursor.occurredAt}::timestamptz`,
            and(
              sql`${auditEvent.occurredAt} = ${cursor.occurredAt}::timestamptz`,
              sql`${auditEvent.id} < ${cursor.id}::uuid`,
            ),
          ),
        );
      }

      const rows = await transaction
        .select({
          event: auditEvent,
          cursorOccurredAt: sql<string>`to_char(${auditEvent.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(auditEvent)
        .where(predicates.length ? and(...predicates) : undefined)
        .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      const page: AuditEventPage = {
        events: selected.map(({ event }) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
          actorId: event.actorId ?? null,
          requestId: event.requestId ?? null,
          reason: event.reason ?? null,
        })),
        nextCursor:
          hasMore && last
            ? encodeCursor(last.cursorOccurredAt, last.event.id)
            : null,
      };

      await insertAuditEvent(transaction, {
        actorType: "user",
        actorId,
        eventType: "audit.events_viewed",
        subjectType: "audit_collection",
        subjectId: "events",
        metadata: {
          limit: query.limit,
          returned: page.events.length,
          ...(query.eventType ? { eventType: query.eventType } : {}),
          ...(query.actorId ? { filteredActorId: query.actorId } : {}),
        },
      });
      return page;
    });
  }
}

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const audit = pgSchema("audit");

export const auditEvent = audit.table(
  "event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    actorType: text("actor_type")
      .$type<"user" | "service" | "anonymous">()
      .notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    requestId: text("request_id"),
    reason: text("reason"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    check(
      "event_actor_type_check",
      sql`${table.actorType} in ('user', 'service', 'anonymous')`,
    ),
    index("event_occurred_at_id_idx").on(table.occurredAt, table.id),
    index("event_subject_time_idx").on(
      table.subjectType,
      table.subjectId,
      table.occurredAt,
    ),
    index("event_actor_time_idx").on(
      table.actorType,
      table.actorId,
      table.occurredAt,
    ),
    index("event_type_time_idx").on(table.eventType, table.occurredAt),
  ],
);

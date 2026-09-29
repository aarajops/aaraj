import { ASSIGNED_ROLES } from "@aaraj/contracts";
import {
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "../../auth/auth-schema.js";

export const accessSchema = pgSchema("access");
export const assignedRole = accessSchema.enum("assigned_role", ASSIGNED_ROLES);
export const roleAssignment = accessSchema.table(
  "role_assignment",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: assignedRole("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedBy: text("granted_by").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("role_assignment_role_idx").on(table.role),
  ],
);

import { Injectable } from "@nestjs/common";
import {
  PermissionSchema,
  RoleSchema,
  type EffectiveAccess,
  type Permission,
  type Role,
} from "@aaraj/contracts";
import { eq } from "drizzle-orm";
import { user } from "../../auth/auth-schema.js";
import { DatabaseService } from "../database/database.service.js";
import type { AuditTransaction } from "../audit/audit.types.js";
import { roleAssignment } from "./access-schema.js";
import { permissionsForRoles } from "./access.permissions.js";

export type AccessPrincipal = { id: string };
export type AccessDatabase = DatabaseService["db"] | AuditTransaction;

@Injectable()
export class PermissionsService {
  constructor(private readonly database: DatabaseService) {}

  async forUser(
    userId: string,
    db: AccessDatabase = this.database.db,
  ): Promise<EffectiveAccess | null> {
    // Start at the identity row: a deleted account must not gain fallback access.
    const rows = await db
      .select({ role: roleAssignment.role })
      .from(user)
      .leftJoin(roleAssignment, eq(user.id, roleAssignment.userId))
      .where(eq(user.id, userId));
    if (rows.length === 0) return null;
    const assigned = new Set<Role>(["customer"]);
    for (const row of rows) {
      if (row.role && RoleSchema.safeParse(row.role).success)
        assigned.add(row.role);
    }
    const roles = RoleSchema.options.filter((role) => assigned.has(role));
    return { userId, roles, permissions: permissionsForRoles(roles) };
  }

  async has(
    user: AccessPrincipal | null,
    permission: Permission,
    db?: AccessDatabase,
  ): Promise<boolean> {
    if (!user?.id || !PermissionSchema.safeParse(permission).success)
      return false;
    const access = await this.forUser(user.id, db);
    return access?.permissions.includes(permission) ?? false;
  }
}

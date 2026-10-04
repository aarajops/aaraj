import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import {
  AccessUserIdSchema,
  AssignedRoleSchema,
  RoleChangeSchema,
  type AssignedRole,
  type RoleChangeInput,
} from "@aaraj/contracts";
import { and, eq, sql } from "drizzle-orm";
import { user } from "../../auth/auth-schema.js";
import { DatabaseService } from "../database/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuditTransaction } from "../audit/audit.types.js";
import { roleAssignment } from "./access-schema.js";
import { AccessPolicy } from "./access.policy.js";
import {
  PermissionsService,
  type AccessPrincipal,
} from "./permissions.service.js";

@Injectable()
export class AccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permissions: PermissionsService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async getOwnAccess(actor: AccessPrincipal) {
    await this.authorization.authorize(AccessPolicy, "readSelf", actor);
    return this.permissions.forUser(actor.id);
  }

  async getUserAccess(actor: AccessPrincipal, userId: string) {
    await this.authorization.authorize(AccessPolicy, "read", actor);
    const access = await this.permissions.forUser(userId);
    if (!access) throw new NotFoundException("User not found");
    return access;
  }

  async changeRole(
    actor: AccessPrincipal,
    userId: string,
    role: AssignedRole,
    action: "grant" | "revoke",
    input: RoleChangeInput,
  ) {
    const reason = this.validateChange(userId, role, input);
    return this.database.db.transaction(async (tx) => {
      await this.lockChanges(tx);
      // Authorize within the serialized transaction before changing assignments.
      await this.authorization.authorize(AccessPolicy, "manage", actor, tx);
      if (action === "grant" && actor.id === userId) {
        throw new ForbiddenException("Cannot grant roles to yourself");
      }
      const before = await this.permissions.forUser(userId, tx);
      if (!before) throw new NotFoundException("User not found");

      const assigned = before.roles.includes(role);
      if (
        (action === "grant" && assigned) ||
        (action === "revoke" && !assigned)
      ) {
        return before; // Idempotent retry: no duplicate mutation or audit event.
      }
      if (action === "revoke" && role === "superadmin") {
        const owners = await tx
          .select({ userId: roleAssignment.userId })
          .from(roleAssignment)
          .where(eq(roleAssignment.role, "superadmin"))
          .limit(2);
        if (owners.length < 2)
          throw new ConflictException("Cannot remove the last superadmin");
      }
      if (action === "grant") {
        await tx
          .insert(roleAssignment)
          .values({ userId, role, grantedBy: actor.id });
      } else {
        await tx
          .delete(roleAssignment)
          .where(
            and(
              eq(roleAssignment.userId, userId),
              eq(roleAssignment.role, role),
            ),
          );
      }
      await this.audit.append(tx, {
        actorType: "user",
        actorId: actor.id,
        eventType:
          action === "grant" ? "access.role_granted" : "access.role_revoked",
        subjectType: "user",
        subjectId: userId,
        reason,
        metadata: { role, action },
      });
      return this.permissions.forUser(userId, tx);
    });
  }

  // Operator-only entry point used by the CLI. Never expose as an HTTP endpoint.
  async bootstrapSuperadmin(userId: string, input: RoleChangeInput) {
    const reason = this.validateChange(userId, "superadmin", input);
    return this.database.db.transaction(async (tx) => {
      await this.lockChanges(tx);
      const existing = await tx
        .select({ userId: roleAssignment.userId })
        .from(roleAssignment)
        .where(eq(roleAssignment.role, "superadmin"))
        .limit(1);
      if (existing.length)
        throw new ConflictException(
          "A superadmin already exists; use the authorized role API",
        );
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId));
      if (!target) throw new NotFoundException("User not found");
      await tx
        .insert(roleAssignment)
        .values({ userId, role: "superadmin", grantedBy: "bootstrap-cli" });
      await this.audit.append(tx, {
        actorType: "service",
        actorId: "bootstrap-cli",
        eventType: "access.superadmin_bootstrapped",
        subjectType: "user",
        subjectId: userId,
        reason,
        metadata: { role: "superadmin" },
      });
      return this.permissions.forUser(userId, tx);
    });
  }

  private validateChange(
    userId: string,
    role: AssignedRole,
    input: RoleChangeInput,
  ): string {
    const parsed = RoleChangeSchema.safeParse(input);
    if (
      !AccessUserIdSchema.safeParse(userId).success ||
      !AssignedRoleSchema.safeParse(role).success ||
      !parsed.success
    ) {
      throw new BadRequestException(
        "A valid user ID, assignable role, and reason (3–500 characters) are required",
      );
    }
    return parsed.data.reason;
  }

  private async lockChanges(tx: AuditTransaction): Promise<void> {
    // All assignment writes (including bootstrap) share this PostgreSQL lock.
    // READ COMMITTED sees the preceding committed grant/revocation after waiting.
    await tx.execute(sql`select pg_advisory_xact_lock(1734439521, 1)`);
  }
}

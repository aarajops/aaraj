import { z } from "zod";

export const ASSIGNED_ROLES = [
  "superadmin",
  "admin",
  "staff",
  "moderator",
] as const;
export const RoleSchema = z.enum([...ASSIGNED_ROLES, "customer"]);
export type Role = z.infer<typeof RoleSchema>;
// Every authenticated account has customer access; only elevated roles are stored.
export const AssignedRoleSchema = z.enum(ASSIGNED_ROLES);
export type AssignedRole = z.infer<typeof AssignedRoleSchema>;

export const AccessUserIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const RoleChangeSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type RoleChangeInput = z.infer<typeof RoleChangeSchema>;

export const PermissionSchema = z.enum([
  "access.read_self",
  "access.read",
  "access.manage",
  "audit.read",
  "catalog.manage",
  "catalog.categories.manage",
  "inventory.manage",
  "orders.manage",
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const EffectiveAccessSchema = z.strictObject({
  userId: AccessUserIdSchema,
  roles: z.array(RoleSchema),
  permissions: z.array(PermissionSchema),
});
export type EffectiveAccess = z.infer<typeof EffectiveAccessSchema>;

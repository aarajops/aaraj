import { z } from "zod";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";

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
  "delivery.tariff.manage",
  "storefront.settings.manage",
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const AccessRoleCatalogEntrySchema = z.strictObject({
  role: RoleSchema,
  permissions: z.array(PermissionSchema),
});
export type AccessRoleCatalogEntry = z.infer<
  typeof AccessRoleCatalogEntrySchema
>;
export const AccessRoleCatalogSchema = z.array(AccessRoleCatalogEntrySchema);
export type AccessRoleCatalog = z.infer<typeof AccessRoleCatalogSchema>;

export const EffectiveAccessSchema = z.strictObject({
  userId: AccessUserIdSchema,
  roles: z.array(RoleSchema),
  permissions: z.array(PermissionSchema),
});
export type EffectiveAccess = z.infer<typeof EffectiveAccessSchema>;

const OptionalAccessUserSearchSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(254).optional(),
);

export const AccessUserListQuerySchema = OffsetPaginationQuerySchema.extend({
  search: OptionalAccessUserSearchSchema,
});
export type AccessUserListQuery = z.infer<typeof AccessUserListQuerySchema>;

export const AccessManagedUserSchema = z.strictObject({
  id: AccessUserIdSchema,
  name: z.string().min(1).max(255),
  email: z.email().max(254),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  roles: z.array(RoleSchema),
});
export type AccessManagedUser = z.infer<typeof AccessManagedUserSchema>;

export const AccessUserPageSchema = z.strictObject({
  users: AccessManagedUserSchema.array(),
  ...OffsetPaginationMetadataSchema.shape,
});
export type AccessUserPage = z.infer<typeof AccessUserPageSchema>;

import {
  PermissionSchema,
  RoleSchema,
  type Permission,
  type Role,
} from "@aaraj/contracts";

// Explicit grants, with no role hierarchy or wildcard administrator bypass.
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superadmin: [
    "access.read_self",
    "access.read",
    "access.manage",
    "audit.read",
    "catalog.manage",
    "catalog.categories.manage",
    "inventory.manage",
    "orders.manage",
  ],
  admin: [
    "access.read_self",
    "access.read",
    "catalog.manage",
    "catalog.categories.manage",
    "inventory.manage",
    "orders.manage",
  ],
  staff: [
    "access.read_self",
    "catalog.manage",
    "inventory.manage",
    "orders.manage",
  ],
  moderator: ["access.read_self"],
  customer: ["access.read_self"],
};

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  return PermissionSchema.options.filter((permission) =>
    roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission)),
  );
}

export function accessCatalog() {
  return RoleSchema.options.map((role) => ({
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
  }));
}

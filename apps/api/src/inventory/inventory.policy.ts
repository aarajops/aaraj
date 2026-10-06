import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessDatabase,
  type AccessPrincipal,
} from "../platform/authorization/permissions.service.js";

@Policy()
export class InventoryPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  manage(user: AccessPrincipal | null, db?: AccessDatabase) {
    return this.permissions.has(user, "inventory.manage", db);
  }
}

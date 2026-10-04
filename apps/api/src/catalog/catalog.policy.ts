import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessDatabase,
  type AccessPrincipal,
} from "../platform/authorization/permissions.service.js";

@Policy()
export class CatalogPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  manage(user: AccessPrincipal | null, db?: AccessDatabase) {
    return this.permissions.has(user, "catalog.manage", db);
  }

  manageCategories(user: AccessPrincipal | null, db?: AccessDatabase) {
    return this.permissions.has(user, "catalog.categories.manage", db);
  }
}

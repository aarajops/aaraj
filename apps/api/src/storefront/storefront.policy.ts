import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessDatabase,
  type AccessPrincipal,
} from "../platform/authorization/permissions.service.js";

@Policy()
export class StorefrontPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  manageSettings(user: AccessPrincipal | null, db?: AccessDatabase) {
    return this.permissions.has(user, "storefront.settings.manage", db);
  }
}

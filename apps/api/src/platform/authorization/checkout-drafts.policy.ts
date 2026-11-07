import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessPrincipal,
} from "./permissions.service.js";

@Policy()
export class CheckoutDraftsPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  manage(user: AccessPrincipal | null) {
    return this.permissions.has(user, "checkout_drafts.manage");
  }
}

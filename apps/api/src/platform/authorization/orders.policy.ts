import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessPrincipal,
} from "./permissions.service.js";

@Policy()
export class OrdersPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  manage(user: AccessPrincipal | null) {
    return this.permissions.has(user, "orders.manage");
  }
}

import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessPrincipal,
} from "./permissions.service.js";

@Policy()
export class AuditPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  read(user: AccessPrincipal | null) {
    return this.permissions.has(user, "audit.read");
  }
}

import { Policy } from "@nestjs/authorization";
import {
  PermissionsService,
  type AccessDatabase,
  type AccessPrincipal,
} from "./permissions.service.js";

@Policy()
export class AccessPolicy {
  constructor(private readonly permissions: PermissionsService) {}

  readSelf(user: AccessPrincipal | null) {
    return this.permissions.has(user, "access.read_self");
  }

  read(user: AccessPrincipal | null) {
    return this.permissions.has(user, "access.read");
  }

  manage(user: AccessPrincipal | null, db?: AccessDatabase) {
    return this.permissions.has(user, "access.manage", db);
  }
}

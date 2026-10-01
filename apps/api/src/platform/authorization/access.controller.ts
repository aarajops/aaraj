import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  AccessUserIdSchema,
  AssignedRoleSchema,
  RoleChangeSchema,
  type AssignedRole,
  type RoleChangeInput,
} from "@aaraj/contracts";
import { AccessPolicy } from "./access.policy.js";
import { AccessService } from "./access.service.js";
import { accessCatalog } from "./access.permissions.js";
import { CookieMutationGuard } from "./cookie-mutation.guard.js";

@Controller("access")
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get("me")
  @Header("Cache-Control", "no-store")
  @Can(AccessPolicy, "readSelf")
  me(@Session() session: UserSession) {
    return this.access.getOwnAccess(session.user);
  }

  @Get("roles")
  @Header("Cache-Control", "no-store")
  @Can(AccessPolicy, "read")
  roles() {
    return accessCatalog();
  }

  @Get("users/:userId")
  @Header("Cache-Control", "no-store")
  @Can(AccessPolicy, "read")
  user(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
  ) {
    return this.access.getUserAccess(session.user, userId);
  }

  @Put("users/:userId/roles/:role")
  @Can(AccessPolicy, "manage")
  grant(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
    @Param("role", { schema: AssignedRoleSchema }) role: AssignedRole,
    @Body({ schema: RoleChangeSchema }) input: RoleChangeInput,
  ) {
    return this.access.changeRole(session.user, userId, role, "grant", input);
  }

  @Delete("users/:userId/roles/:role")
  @Can(AccessPolicy, "manage")
  revoke(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
    @Param("role", { schema: AssignedRoleSchema }) role: AssignedRole,
    @Body({ schema: RoleChangeSchema }) input: RoleChangeInput,
  ) {
    return this.access.changeRole(session.user, userId, role, "revoke", input);
  }
}

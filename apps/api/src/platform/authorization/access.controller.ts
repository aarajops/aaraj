import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Query,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  AccessUserIdSchema,
  AccessUserListQuerySchema,
  AssignedRoleSchema,
  RoleChangeSchema,
  type AccessUserListQuery,
  type AssignedRole,
  type RoleChangeInput,
} from "@aaraj/contracts";
import { AccessPolicy } from "./access.policy.js";
import { AccessService } from "./access.service.js";
import { accessCatalog } from "./access.permissions.js";
import { CookieMutationGuard } from "./cookie-mutation.guard.js";

@Controller("access")
@ApiCookieAuth()
@UsePipes(StandardSchemaValidationPipe)
@UseGuards(CookieMutationGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get("me")
  @Header("Cache-Control", "no-store")
  me(@Session() session: UserSession) {
    return this.access.getOwnAccess(session.user);
  }

  @Get("roles")
  @Header("Cache-Control", "no-store")
  @Can(AccessPolicy, "read")
  roles() {
    return accessCatalog();
  }

  @Get("users")
  @Header("Cache-Control", "no-store")
  listUsers(
    @Session() session: UserSession,
    @Query({ schema: AccessUserListQuerySchema }) query: AccessUserListQuery,
  ) {
    return this.access.listUsers(session.user, query);
  }

  @Get("users/:userId")
  @Header("Cache-Control", "no-store")
  user(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
  ) {
    return this.access.getUserAccess(session.user, userId);
  }

  @Put("users/:userId/roles/:role")
  grant(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
    @Param("role", { schema: AssignedRoleSchema }) role: AssignedRole,
    @Body({ schema: RoleChangeSchema }) input: RoleChangeInput,
  ) {
    return this.access.changeRole(session.user, userId, role, "grant", input);
  }

  @Delete("users/:userId/roles/:role")
  revoke(
    @Session() session: UserSession,
    @Param("userId", { schema: AccessUserIdSchema }) userId: string,
    @Param("role", { schema: AssignedRoleSchema }) role: AssignedRole,
    @Body({ schema: RoleChangeSchema }) input: RoleChangeInput,
  ) {
    return this.access.changeRole(session.user, userId, role, "revoke", input);
  }
}

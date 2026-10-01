import { Can } from "@nestjs/authorization";
import {
  Controller,
  Get,
  Header,
  Query,
  StandardSchemaValidationPipe,
  UsePipes,
} from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { AuditEventQuerySchema, type AuditEventQuery } from "@aaraj/contracts";
import { AuditPolicy } from "../authorization/audit.policy.js";
import { AuditService } from "./audit.service.js";

@Controller("audit/events")
@UsePipes(StandardSchemaValidationPipe)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @Can(AuditPolicy, "read")
  list(
    @Session() session: UserSession,
    @Query({ schema: AuditEventQuerySchema }) query: AuditEventQuery,
  ) {
    return this.audit.list(query, session.user.id);
  }
}

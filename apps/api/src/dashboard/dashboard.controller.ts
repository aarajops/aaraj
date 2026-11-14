import {
  Controller,
  Get,
  Header,
  Query,
  StandardSchemaValidationPipe,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  DashboardOverviewQuerySchema,
  type DashboardOverviewQuery,
} from "@aaraj/contracts";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { DashboardService } from "./dashboard.service.js";

@Controller("dashboard")
@UsePipes(StandardSchemaValidationPipe)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  getOverview(
    @Query({ schema: DashboardOverviewQuerySchema })
    query: DashboardOverviewQuery,
  ) {
    return this.dashboard.getOverview(query.range);
  }
}

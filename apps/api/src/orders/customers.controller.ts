import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  StandardSchemaValidationPipe,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import {
  CustomerDirectoryIdSchema,
  CustomerDirectoryQuerySchema,
  CustomerOrdersQuerySchema,
  ManualOrderCustomerSearchQuerySchema,
  type CustomerDirectoryQuery,
  type CustomerOrdersQuery,
  type ManualOrderCustomerSearchQuery,
} from "@aaraj/contracts";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { OrdersService } from "./orders.service.js";

@Controller("customers")
@ApiCookieAuth()
@UsePipes(StandardSchemaValidationPipe)
export class CustomersController {
  constructor(private readonly orders: OrdersService) {}

  @Get("manage")
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  list(
    @Query({ schema: CustomerDirectoryQuerySchema })
    query: CustomerDirectoryQuery,
  ) {
    return this.orders.listCustomerDirectory(query);
  }

  @Get("manage/accounts")
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  searchManualOrderAccounts(
    @Query({ schema: ManualOrderCustomerSearchQuerySchema })
    query: ManualOrderCustomerSearchQuery,
  ) {
    return this.orders.searchManualOrderAccounts(query.search);
  }

  @Get("manage/:customerKey/orders")
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  ordersForCustomer(
    @Param("customerKey", { schema: CustomerDirectoryIdSchema })
    customerKey: string,
    @Query({ schema: CustomerOrdersQuerySchema }) query: CustomerOrdersQuery,
  ) {
    return this.orders.listCustomerOrders(customerKey, query);
  }
}

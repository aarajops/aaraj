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
  type CustomerDirectoryQuery,
  type CustomerOrdersQuery,
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

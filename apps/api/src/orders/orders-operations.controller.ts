import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  StandardSchemaValidationPipe,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Can } from "@nestjs/authorization";
import { ApiCookieAuth } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  CreateOrderReturnInputSchema,
  DecideOrderReturnInputSchema,
  ImportCourierRemittanceInputSchema,
  InspectOrderReturnInputSchema,
  OrderIdSchema,
  ReceiveOrderReturnInputSchema,
  RecordOrderReturnRefundInputSchema,
  ReconcileCourierRemittanceInputSchema,
  ResolveCourierRemittanceLineInputSchema,
  ConfirmCourierSettlementInputSchema,
} from "@aaraj/contracts";
import type {
  CreateOrderReturnInput,
  DecideOrderReturnInput,
  ImportCourierRemittanceInput,
  InspectOrderReturnInput,
  ReceiveOrderReturnInput,
  ReconcileCourierRemittanceInput,
  RecordOrderReturnRefundInput,
  ResolveCourierRemittanceLineInput,
  ConfirmCourierSettlementInput,
} from "@aaraj/contracts";
import { CookieMutationGuard } from "../platform/authorization/cookie-mutation.guard.js";
import { OrdersFinancePolicy } from "../platform/authorization/orders-finance.policy.js";
import { OrdersPolicy } from "../platform/authorization/orders.policy.js";
import { OrdersOperationsService } from "./orders-operations.service.js";

@Controller("orders")
@UsePipes(StandardSchemaValidationPipe)
export class OrdersOperationsController {
  constructor(private readonly operations: OrdersOperationsService) {}

  @Get("manage/:orderId/returns")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  listReturnCases(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
  ) {
    return this.operations.listReturnCases({ id: session.user.id }, orderId);
  }

  @Get("manage/:orderId/receipt")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  getOrderReceipt(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
  ) {
    return this.operations.getOrderReceipt({ id: session.user.id }, orderId);
  }

  @Post("manage/:orderId/receipt")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  issueOrderReceipt(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
  ) {
    return this.operations.issueOrderReceipt({ id: session.user.id }, orderId);
  }

  @Get("manage/returns/:returnCaseId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  getReturnCase(
    @Session() session: UserSession,
    @Param("returnCaseId", { schema: OrderIdSchema }) returnCaseId: string,
  ) {
    return this.operations.getReturnCase({ id: session.user.id }, returnCaseId);
  }

  @Post("manage/:orderId/returns")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  createReturnCase(
    @Session() session: UserSession,
    @Param("orderId", { schema: OrderIdSchema }) orderId: string,
    @Body({ schema: CreateOrderReturnInputSchema }) input: unknown,
  ) {
    return this.operations.createReturnCase(
      { id: session.user.id },
      orderId,
      input as CreateOrderReturnInput,
    );
  }

  @Patch("manage/returns/:returnCaseId/decision")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  decideReturnCase(
    @Session() session: UserSession,
    @Param("returnCaseId", { schema: OrderIdSchema }) returnCaseId: string,
    @Body({ schema: DecideOrderReturnInputSchema }) input: unknown,
  ) {
    return this.operations.decideReturnCase(
      { id: session.user.id },
      returnCaseId,
      input as DecideOrderReturnInput,
    );
  }

  @Post("manage/returns/:returnCaseId/receive")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  receiveReturn(
    @Session() session: UserSession,
    @Param("returnCaseId", { schema: OrderIdSchema }) returnCaseId: string,
    @Body({ schema: ReceiveOrderReturnInputSchema }) input: unknown,
  ) {
    return this.operations.receiveReturn(
      { id: session.user.id },
      returnCaseId,
      input as ReceiveOrderReturnInput,
    );
  }

  @Post("manage/returns/:returnCaseId/inspect")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersPolicy, "manage")
  @UseGuards(CookieMutationGuard)
  inspectReturn(
    @Session() session: UserSession,
    @Param("returnCaseId", { schema: OrderIdSchema }) returnCaseId: string,
    @Body({ schema: InspectOrderReturnInputSchema }) input: unknown,
  ) {
    return this.operations.inspectReturn(
      { id: session.user.id },
      returnCaseId,
      input as InspectOrderReturnInput,
    );
  }

  @Post("manage/returns/:returnCaseId/refund")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  @UseGuards(CookieMutationGuard)
  recordReturnRefund(
    @Session() session: UserSession,
    @Param("returnCaseId", { schema: OrderIdSchema }) returnCaseId: string,
    @Body({ schema: RecordOrderReturnRefundInputSchema }) input: unknown,
  ) {
    return this.operations.recordReturnRefund(
      { id: session.user.id },
      returnCaseId,
      input as RecordOrderReturnRefundInput,
    );
  }

  @Post("manage/remittances")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  @UseGuards(CookieMutationGuard)
  importCourierRemittance(
    @Session() session: UserSession,
    @Body({ schema: ImportCourierRemittanceInputSchema }) input: unknown,
  ) {
    return this.operations.importCourierRemittance(
      { id: session.user.id },
      input as ImportCourierRemittanceInput,
    );
  }

  @Get("manage/remittances/:batchId")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  getCourierRemittance(
    @Session() session: UserSession,
    @Param("batchId", { schema: OrderIdSchema }) batchId: string,
  ) {
    return this.operations.getCourierRemittance(
      { id: session.user.id },
      batchId,
    );
  }

  @Get("manage/remittances")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  listCourierRemittances(@Session() session: UserSession) {
    return this.operations.listCourierRemittances({ id: session.user.id });
  }

  @Post("manage/remittances/:batchId/reconcile")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  @UseGuards(CookieMutationGuard)
  reconcileCourierRemittance(
    @Session() session: UserSession,
    @Param("batchId", { schema: OrderIdSchema }) batchId: string,
    @Body({ schema: ReconcileCourierRemittanceInputSchema }) input: unknown,
  ) {
    return this.operations.reconcileCourierRemittance(
      { id: session.user.id },
      batchId,
      input as ReconcileCourierRemittanceInput,
    );
  }

  @Post("manage/remittances/:batchId/bank-confirmation")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  @UseGuards(CookieMutationGuard)
  confirmCourierSettlement(
    @Session() session: UserSession,
    @Param("batchId", { schema: OrderIdSchema }) batchId: string,
    @Body({ schema: ConfirmCourierSettlementInputSchema }) input: unknown,
  ) {
    return this.operations.confirmCourierSettlement(
      { id: session.user.id },
      batchId,
      input as ConfirmCourierSettlementInput,
    );
  }

  @Patch("manage/remittances/:batchId/lines/:lineId/resolve")
  @ApiCookieAuth()
  @Header("Cache-Control", "no-store")
  @Can(OrdersFinancePolicy, "manage")
  @UseGuards(CookieMutationGuard)
  resolveCourierRemittanceLine(
    @Session() session: UserSession,
    @Param("batchId", { schema: OrderIdSchema }) batchId: string,
    @Param("lineId", { schema: OrderIdSchema }) lineId: string,
    @Body({ schema: ResolveCourierRemittanceLineInputSchema }) input: unknown,
  ) {
    return this.operations.resolveCourierRemittanceLine(
      { id: session.user.id },
      batchId,
      lineId,
      input as ResolveCourierRemittanceLineInput,
    );
  }
}

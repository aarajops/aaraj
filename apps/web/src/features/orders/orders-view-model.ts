import "server-only";

import type {
  OrderManagementList,
  PathaoManagementBookingSummary,
} from "@aaraj/contracts";

export type ManagedOrderRow = OrderManagementList["rows"][number] & {
  pathaoSummary: PathaoManagementBookingSummary | null;
};

export type ManagedOrdersPage = Omit<OrderManagementList, "rows"> & {
  rows: ManagedOrderRow[];
  pathaoSummaryAvailable: boolean;
};

export function composeManagedOrdersPage(
  orders: OrderManagementList,
  summaries: PathaoManagementBookingSummary[] | null,
): ManagedOrdersPage {
  const summaryByOrderId = new Map<string, PathaoManagementBookingSummary>(
    (summaries ?? []).map((summary) => [summary.orderId, summary]),
  );

  return {
    ...orders,
    pathaoSummaryAvailable: summaries !== null,
    rows: orders.rows.map((order) => ({
      ...order,
      pathaoSummary: summaryByOrderId.get(order.id) ?? null,
    })),
  };
}

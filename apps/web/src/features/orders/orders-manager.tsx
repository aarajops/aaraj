"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { OrderManagementList } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCatalogPrice } from "@/features/catalog/price";

export function OrdersManager({
  initialPage,
}: {
  initialPage: OrderManagementList;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Review COD Orders and verify delivery serviceability before dispatch
          confirmation. Address details appear only on an authorized Order
          detail page.
        </p>
        <Card className="mt-8 gap-0 rounded-2xl border border-border bg-card/70 p-4 sm:p-6">
          <div className="mb-4 flex justify-end">
            <Button
              disabled={refreshing}
              variant="outline"
              onClick={() => startTransition(() => router.refresh())}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          {initialPage.rows.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No Orders yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-3">Reference</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Delivery review</th>
                    <th className="px-3 py-3">COD due</th>
                    <th className="px-3 py-3">Created</th>
                    <th className="px-3 py-3"> </th>
                  </tr>
                </thead>
                <tbody>
                  {initialPage.rows.map((order) => (
                    <tr className="border-b border-border/70" key={order.id}>
                      <td className="px-3 py-3 font-medium">
                        {order.reference}
                      </td>
                      <td className="px-3 py-3">{humanize(order.status)}</td>
                      <td className="px-3 py-3">
                        {humanize(order.serviceability)}
                      </td>
                      <td className="px-3 py-3">
                        {order.status === "cancelled" ||
                        order.status === "rejected"
                          ? "Not payable"
                          : formatCatalogPrice({ amountBdt: order.totalBdt })}
                      </td>
                      <td className="px-3 py-3">
                        {formatDate(order.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          className="text-primary underline"
                          href={`/admin/orders/${order.id}`}
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Showing the newest {initialPage.rows.length} Orders.
          </p>
        </Card>
      </div>
    </main>
  );
}

export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

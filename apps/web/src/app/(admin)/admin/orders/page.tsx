import type { Metadata } from "next";
import Link from "next/link";
import { OrdersManager } from "@/features/orders/orders-manager";
import {
  getManagedOrders,
  parseOrdersPageQuery,
  type OrdersPageSearchParams,
} from "@/features/orders/orders-queries";

export const metadata: Metadata = {
  title: "Order management",
  description:
    "Review COD Orders and verify Bangladesh delivery serviceability.",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersPageSearchParams>;
}) {
  const query = parseOrdersPageQuery(await searchParams);
  const result = await getManagedOrders(query);
  if ("kind" in result) {
    const title =
      result.kind === "unauthenticated"
        ? "Sign in to continue"
        : result.kind === "forbidden"
          ? "Order management access required"
          : "Orders unavailable";
    return (
      <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-12 text-foreground sm:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary">
            AARAJ STAFF
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Order management</h1>
          <section
            className="mt-8 rounded-2xl border border-border p-7"
            role="alert"
          >
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-muted-foreground">
              {result.kind === "unauthenticated"
                ? "Sign in with an Aaraj staff account to review Orders."
                : result.kind === "forbidden"
                  ? "Your account cannot access customer Orders."
                  : "Order management could not be loaded. Try again shortly."}
            </p>
            {result.kind !== "unauthenticated" && (
              <Link
                className="mt-4 inline-flex text-primary underline"
                href={ordersPageHref(query)}
              >
                Try again
              </Link>
            )}
          </section>
        </div>
      </main>
    );
  }
  return <OrdersManager initialPage={result.value} query={query} />;
}

function ordersPageHref(query: {
  limit: number;
  offset: number;
  search?: string;
  fulfillmentStatus?: string;
}): string {
  const params = new URLSearchParams();
  if (query.limit !== 50) params.set("limit", String(query.limit));
  if (query.offset > 0) params.set("offset", String(query.offset));
  if (query.search) params.set("search", query.search);
  if (query.fulfillmentStatus) {
    params.set("fulfillmentStatus", query.fulfillmentStatus);
  }
  const search = params.toString();
  return search ? `/admin/orders?${search}` : "/admin/orders";
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import type {
  CustomerDirectoryQuery,
  ManagedCustomer,
  ManagedCustomerDirectory,
  ManagedCustomerOrder,
  ManagedCustomerOrdersPage,
} from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { OrderStatusBadge } from "@/features/orders/order-status-badges";
import { fetchManagedCustomerOrders } from "./customers-client";

const columnHelper = createDataTableColumnHelper<ManagedCustomer>();
const CUSTOMER_ORDER_PAGE_SIZE = 20;

export function CustomersManager({
  initialPage,
  query,
}: {
  initialPage: ManagedCustomerDirectory;
  query: CustomerDirectoryQuery;
}) {
  const router = useRouter();
  const [selectedCustomer, setSelectedCustomer] =
    useState<ManagedCustomer | null>(null);
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "customer",
          header: "Customer",
          cell: ({ row }) => (
            <div className="grid min-w-40 gap-1">
              <span className="font-medium">{row.original.name}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {row.original.identityType === "account"
                    ? "Account"
                    : "Guest order"}
                </Badge>
                {row.original.email && (
                  <span className="break-all text-xs text-muted-foreground">
                    {row.original.email}
                  </span>
                )}
              </div>
            </div>
          ),
        }),
        columnHelper.display({
          id: "recipient",
          header: "Latest recipient",
          cell: ({ row }) => (
            <div className="grid gap-1">
              <span>{row.original.latestRecipientName}</span>
              <a
                className="w-fit rounded-sm text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
                href={`tel:${row.original.latestRecipientPhone}`}
                aria-label={`Call ${row.original.latestRecipientName} at ${row.original.latestRecipientPhone}`}
              >
                {row.original.latestRecipientPhone}
              </a>
            </div>
          ),
        }),
        columnHelper.display({
          id: "orders",
          header: "Orders",
          meta: { align: "right", numeric: true },
          cell: ({ row }) => (
            <Button
              aria-label={`View ${row.original.orderCount} orders for ${row.original.name}`}
              className="h-auto px-0 py-0 font-medium"
              onClick={() => setSelectedCustomer(row.original)}
              type="button"
              variant="link"
            >
              {row.original.orderCount}
            </Button>
          ),
        }),
        columnHelper.accessor("lastOrderAt", {
          header: "Last order",
          cell: ({ getValue }) => formatDateTime(getValue()),
        }),
        columnHelper.display({
          id: "latestOrder",
          header: "Latest order",
          cell: ({ row }) => (
            <div className="grid gap-1">
              <Link
                className="w-fit rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
                href={`/admin/orders?search=${encodeURIComponent(row.original.latestOrder.reference)}`}
              >
                {row.original.latestOrder.reference}
              </Link>
              <OrderStatusBadge status={row.original.latestOrder.status} />
            </div>
          ),
        }),
      ]),
    [],
  );

  return (
    <>
      <div>
        <AdminPageHeader
          title="Customers"
          description="Buyers with a placed order. Guest orders stay separate because a delivery phone may be shared."
        />
        <AdminDataTable
          className="mt-6"
          ariaLabel="Customers"
          columns={columns}
          data={initialPage.rows}
          rowActions={(customer) => (
            <DropdownMenuItem
              aria-haspopup="dialog"
              onClick={() => setSelectedCustomer(customer)}
            >
              <Eye aria-hidden="true" className="size-4" />
              View order history
            </DropdownMenuItem>
          )}
          emptyMessage={
            query.search
              ? "No matching customers. Clear the search to browse all customers."
              : "No customers yet. A customer appears after an order is placed."
          }
          page={initialPage}
          itemName="customers"
          onRefresh={() => router.refresh()}
          pathname="/admin/customers"
          query={query}
          searchPlaceholder="Search name, phone, email, or order ID"
        />
      </div>
      <CustomerOrdersSheet
        key={selectedCustomer?.id ?? "closed"}
        customer={selectedCustomer}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomer(null);
        }}
      />
    </>
  );
}

function CustomerOrdersSheet({
  customer,
  onOpenChange,
}: {
  customer: ManagedCustomer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<ManagedCustomerOrder[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    void fetchManagedCustomerOrders(customer.id, CUSTOMER_ORDER_PAGE_SIZE, 0)
      .then((page) => {
        if (!active) return;
        setRows(page.rows);
        setNextOffset(page.nextOffset);
      })
      .catch(() => {
        if (active) setError("Could not load this customer's order history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer]);

  async function loadMore() {
    if (!customer || nextOffset === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page: ManagedCustomerOrdersPage = await fetchManagedCustomerOrders(
        customer.id,
        CUSTOMER_ORDER_PAGE_SIZE,
        nextOffset,
      );
      setRows((current) => [...current, ...page.rows]);
      setNextOffset(page.nextOffset);
    } catch {
      setError("Could not load more orders. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={customer !== null}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {customer && (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle>{customer.name}</SheetTitle>
              <SheetDescription>
                {customer.identityType === "account"
                  ? customer.email
                  : "Guest checkout contact; identity is not verified."}
              </SheetDescription>
              <div className="pt-2 text-sm">
                <p className="text-muted-foreground">
                  Latest delivery recipient
                </p>
                <p className="font-medium">{customer.latestRecipientName}</p>
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href={`tel:${customer.latestRecipientPhone}`}
                >
                  {customer.latestRecipientPhone}
                </a>
              </div>
            </SheetHeader>
            <section className="px-4 pb-4" aria-label="Customer order history">
              <h3 className="font-semibold">Order history</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {customer.orderCount} placed order
                {customer.orderCount === 1 ? "" : "s"}. Order statuses show the
                current state of each order.
              </p>
              {loading && (
                <p className="mt-4 text-sm text-muted-foreground" role="status">
                  Loading order history…
                </p>
              )}
              {error && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              {!loading && !error && rows.length === 0 && (
                <p className="mt-4 text-sm text-muted-foreground">
                  No orders are available for this customer.
                </p>
              )}
              <ul className="mt-4 divide-y divide-border">
                {rows.map((order) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                    key={order.id}
                  >
                    <div className="grid gap-1">
                      <Link
                        className="w-fit font-medium text-primary underline-offset-4 hover:underline"
                        href={`/admin/orders?search=${encodeURIComponent(order.reference)}`}
                      >
                        {order.reference}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(order.createdAt)} ·{" "}
                        {formatBdtPrice({ amountBdt: order.totalBdt })}
                      </span>
                    </div>
                    <div className="grid justify-items-end gap-1">
                      <OrderStatusBadge status={order.status} />
                      <span className="text-xs text-muted-foreground">
                        {order.fulfillmentStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {nextOffset !== null && (
                <Button
                  className="mt-3 w-full"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  type="button"
                  variant="outline"
                >
                  {loadingMore ? "Loading…" : "Load more orders"}
                </Button>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

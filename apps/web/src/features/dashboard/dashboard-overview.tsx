import Link from "next/link";
import type { DashboardOverview, DashboardRange } from "@aaraj/contracts";
import { BadgeCheck, Banknote, ClipboardList, ShoppingBag } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CountUp from "@/components/ui/count-up";
import { DashboardActivityChart } from "./dashboard-activity-chart";
import { MetricCard } from "./dashboard-metric-card";

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "90d", label: "Last 3 months" },
  { value: "30d", label: "Last 30 days" },
  { value: "7d", label: "Last 7 days" },
];

const count = new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 });
const dateLabel = new Intl.DateTimeFormat("en-BD", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Dhaka",
});

export function DashboardOverviewView({
  overview,
  range,
}: {
  overview: DashboardOverview;
  range: DashboardRange;
}) {
  const cancelledNote = overview.summary.cancelledOrders
    ? `Includes ${count.format(overview.summary.cancelledOrders)} cancelled`
    : undefined;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        actions={
          <Link
            className="inline-flex min-h-9 items-center rounded-md text-sm text-primary hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
            href="/admin/orders"
          >
            Review orders
          </Link>
        }
        title="Overview"
      />

      <section
        aria-label="Business summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          detail={cancelledNote}
          icon={ShoppingBag}
          title="Orders placed"
          value={
            <CountUp
              duration={0.8}
              separator=","
              to={overview.summary.ordersPlaced}
            />
          }
        />
        <MetricCard
          help="Current value of non-cancelled orders in this period. This is not cash collected."
          icon={Banknote}
          title="COD order value"
          value={<CurrencyValue value={overview.summary.currentCodValueBdt} />}
        />
        <MetricCard
          help="Net total of recorded COD reconciliation changes in this period. It can be negative."
          icon={BadgeCheck}
          title="COD reconciled"
          value={<CurrencyValue value={overview.summary.codReconciledBdt} />}
        />
        <MetricCard
          icon={ClipboardList}
          title="Needs action"
          value={
            <CountUp
              duration={0.8}
              separator=","
              to={overview.operations.awaitingStaffAction}
            />
          }
        />
      </section>

      <Card>
        <CardHeader className="gap-4 lg:flex lg:items-start lg:justify-between">
          <div className="grid gap-1">
            <CardTitle>Orders placed</CardTitle>
            <CardDescription>
              {formatPeriod(overview.from, overview.through)}
            </CardDescription>
          </div>
          <nav
            aria-label="Reporting period"
            className="inline-flex w-fit overflow-hidden rounded-lg border border-input"
          >
            {RANGE_OPTIONS.map((option, index) => (
              <Link
                aria-label={option.label}
                aria-current={range === option.value ? "page" : undefined}
                className={`border-r border-input px-3 py-2 text-sm last:border-r-0 hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${range === option.value ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
                href={`/admin?range=${option.value}`}
                key={option.value}
              >
                <span className="hidden sm:inline">{option.label}</span>
                <span className="sm:hidden">
                  {index === 0 ? "90d" : option.value}
                </span>
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent>
          <DashboardActivityChart data={overview.daily} />
        </CardContent>
      </Card>

      <section
        aria-label="Order operations and top products"
        className="grid gap-4 xl:grid-cols-2"
      >
        <Card>
          <CardHeader>
            <CardTitle>Live operations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <OperationRow
                  label="Awaiting dispatch"
                  value={overview.operations.awaitingDispatch}
                />
                <OperationRow
                  label="In delivery"
                  value={overview.operations.inDelivery}
                />
                <OperationRow
                  label="Partial, failed, or returned"
                  value={overview.operations.deliveryOutcomeOrders}
                />
                <OperationRow
                  label="COD discrepancies"
                  value={overview.operations.collectionDiscrepancies}
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.topProducts.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                No orders in this period.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.topProducts.map((product, index) => (
                    <TableRow
                      key={`${product.productName}:${product.color}:${product.sizeLabel}:${index}`}
                    >
                      <TableCell className="font-medium">
                        {product.productName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {[product.color, product.sizeLabel]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(product.orderedUnits)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function CurrencyValue({ value }: { value: number }) {
  return (
    <>
      <sup className="align-super text-xs text-primary">BDT</sup>
      {"\u00a0"}
      <CountUp duration={0.8} separator="," to={value} />
    </>
  );
}

function OperationRow({ label, value }: { label: string; value: number }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">
        {count.format(value)}
      </TableCell>
    </TableRow>
  );
}

function formatDate(value: string, includeYear = false): string {
  if (!value) return "";
  const formatter = includeYear
    ? new Intl.DateTimeFormat("en-BD", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Dhaka",
      })
    : dateLabel;
  return formatter.format(new Date(`${value}T12:00:00+06:00`));
}

function formatPeriod(from: string, through: string): string {
  const includeYear = from.slice(0, 4) !== through.slice(0, 4);
  return `${formatDate(from, includeYear)}–${formatDate(through, includeYear)}`;
}

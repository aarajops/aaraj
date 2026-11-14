import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { getInitialAccess } from "@/features/auth/auth-session";
import { DashboardOverviewView } from "@/features/dashboard/dashboard-overview";
import {
  getDashboardOverview,
  parseDashboardRange,
} from "@/features/dashboard/dashboard-queries";

export const metadata: Metadata = {
  title: "Admin overview",
  description: "Review Aaraj order activity and fulfillment metrics.",
};

const setupSteps = [
  {
    title: "Build categories",
    description:
      "Create the active category tree first. Products use leaf categories; size guides can cover a category and its subcategories.",
    href: "/admin/catalog/categories",
    action: "Manage categories",
  },
  {
    title: "Add size guides",
    description:
      "Record the supplier’s size labels and measurements for each category and fit.",
    href: "/admin/catalog/size-guides",
    action: "Manage size guides",
  },
  {
    title: "Configure products",
    description:
      "Create each style, then add its sellable color and size variants, SKU, and BDT price.",
    href: "/admin/catalog",
    action: "Manage products",
  },
] as const;

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const access = await getInitialAccess();

  if (!access) redirect("/account");
  const canManageCatalog = access.permissions.includes("catalog.manage");
  const canManageOrders = access.permissions.includes("orders.manage");
  if (!canManageCatalog && !canManageOrders) redirect("/");

  const range = parseDashboardRange((await searchParams).range);
  const dashboard = canManageOrders ? await getDashboardOverview(range) : null;
  const canManageCategories = access.permissions.includes(
    "catalog.categories.manage",
  );
  const visibleSteps = canManageCategories ? setupSteps : setupSteps.slice(1);

  return (
    <div>
      {dashboard && "value" in dashboard ? (
        <DashboardOverviewView overview={dashboard.value} range={range} />
      ) : canManageOrders ? (
        <div>
          <AdminPageHeader
            title="Overview"
            description="Order activity, fulfillment, and cash-on-delivery reconciliation."
          />
          <Card className="mt-6" role="alert">
            <CardHeader>
              <h2 className="font-heading text-xl font-semibold">
                Metrics are unavailable
              </h2>
              <CardDescription>
                Dashboard data could not be loaded. Try again shortly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button nativeButton={false} render={<Link href="/admin" />}>
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {canManageCatalog &&
        (!canManageOrders || !dashboard || !("value" in dashboard)) && (
          <section
            aria-labelledby="catalog-setup-heading"
            className={
              canManageOrders ? "mt-10 border-t border-border pt-8" : ""
            }
          >
            <AdminPageHeader
              title={canManageOrders ? "Catalog setup" : "Catalog overview"}
              description={
                canManageCategories
                  ? "Set up categories, size guides, and products, then review the public catalog."
                  : "Set up size guides and products, then review the public catalog."
              }
            />
            <div className="mt-5">
              <h2
                className="text-xl font-semibold tracking-tight"
                id="catalog-setup-heading"
              >
                Catalog setup
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Follow these steps to configure product data for Aaraj.
              </p>
            </div>

            <ol className="mt-5 grid gap-4 lg:grid-cols-3">
              {visibleSteps.map((step, index) => (
                <li
                  className="flex min-h-56 flex-col rounded-xl border border-border bg-card p-5 shadow-sm"
                  key={step.href}
                >
                  <p className="text-sm font-semibold tabular-nums text-primary">
                    STEP {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                  <Link
                    className="mt-auto inline-flex w-fit items-center gap-2 pt-6 text-sm font-medium text-primary hover:text-primary/80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={step.href}
                  >
                    {step.action}
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ol>

            <section className="mt-8 rounded-xl border border-border bg-muted/40 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
              <div>
                <h2 className="font-semibold">Preview the storefront</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check how published products appear to customers.
                </p>
              </div>
              <Link
                className="mt-4 inline-flex rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mt-0"
                href="/"
              >
                View catalog
              </Link>
            </section>
          </section>
        )}
    </div>
  );
}

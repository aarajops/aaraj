import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getInitialAccess } from "@/features/auth/auth-session";

export const metadata: Metadata = {
  title: "Admin overview",
  description: "Set up and manage the Aaraj product catalog.",
};

const setupSteps = [
  {
    title: "Build categories",
    description:
      "Create the active category tree first. Products and size guides use active leaf categories.",
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

export default async function AdminOverviewPage() {
  const access = await getInitialAccess();

  if (!access) redirect("/account");
  if (!access.permissions.includes("catalog.manage")) redirect("/");

  const canManageCategories = access.permissions.includes(
    "catalog.categories.manage",
  );
  const visibleSteps = canManageCategories ? setupSteps : setupSteps.slice(1);

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Catalog overview
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {canManageCategories
            ? "Prepare the catalog in order: categories, size guides, then products."
            : "Set up size guides and products using the available categories."}{" "}
          Review the public catalog after publishing.
        </p>

        <section aria-labelledby="catalog-setup-heading" className="mt-10">
          <div>
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
        </section>

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
      </div>
    </main>
  );
}

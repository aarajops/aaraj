import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { InventoryManager } from "@/features/inventory/inventory-manager";
import {
  getManagedInventory,
  parseInventoryPageQuery,
  type InventoryPageSearchParams,
} from "@/features/inventory/inventory-queries";

export const metadata: Metadata = {
  title: "Inventory",
  description: "Manage on-hand stock for Aaraj product variants.",
};

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<InventoryPageSearchParams>;
}) {
  const query = parseInventoryPageQuery(await searchParams);
  const result = await getManagedInventory(query);

  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to manage inventory."
        : result.kind === "forbidden"
          ? "Your account does not have permission to manage inventory."
          : "Inventory could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Inventory"
            description="Track stock by product variant."
          />
          <p
            className={`mt-5 rounded-xl border p-5 ${result.kind === "forbidden" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-card/70 text-secondary-foreground"}`}
            role="alert"
          >
            {message}
          </p>
          {result.kind === "unauthenticated" ? (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/account"
            >
              Go to your account
            </Link>
          ) : (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/admin/inventory"
            >
              Try again
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <InventoryManager
      key={JSON.stringify(query)}
      page={result.page}
      query={query}
    />
  );
}

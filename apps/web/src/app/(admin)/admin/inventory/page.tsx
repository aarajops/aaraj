import type { Metadata } from "next";
import Link from "next/link";
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
      <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">Inventory</h1>
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
      </main>
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

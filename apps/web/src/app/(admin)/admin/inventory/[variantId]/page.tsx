import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryVariantIdSchema } from "@aaraj/contracts";
import { InventoryAdjustment } from "@/features/inventory/inventory-adjustment";
import { getManagedInventoryVariant } from "@/features/inventory/inventory-queries";

export const metadata: Metadata = {
  title: "Adjust stock",
  description: "Adjust on-hand stock for a product variant.",
};

export default async function AdminInventoryVariantPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  const { variantId } = await params;
  if (!InventoryVariantIdSchema.safeParse(variantId).success) notFound();

  const result = await getManagedInventoryVariant(variantId);
  if ("kind" in result) {
    if (result.kind === "not-found") notFound();
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to adjust inventory."
        : result.kind === "forbidden"
          ? "Your account does not have permission to adjust inventory."
          : "This variant's inventory could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Adjust stock
          </h1>
          <p
            className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href="/admin/inventory"
          >
            Back to inventory
          </Link>
        </div>
      </main>
    );
  }

  return <InventoryAdjustment variant={result.variant} />;
}

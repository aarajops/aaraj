import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryVariantIdSchema } from "@aaraj/contracts";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
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
      <>
        <div>
          <AdminPageHeader
            backLink={
              <Link className={adminPageLinkClassName} href="/admin/inventory">
                ← Back to inventory
              </Link>
            }
            title="Adjust stock"
            description="Adjust on-hand stock for a product variant."
          />
          <p
            className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
        </div>
      </>
    );
  }

  return <InventoryAdjustment variant={result.variant} />;
}

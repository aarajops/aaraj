import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogSizeGuideIdSchema } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
  getManagedCategoryOptions,
  getManagedSizeGuide,
  parseCatalogSizeGuidePageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Edit size guide",
  description: "Edit a reusable product size guide in the Aaraj catalog.",
};

export default async function EditSizeGuidePage({
  params,
}: {
  params: Promise<{ guideId: string }>;
}) {
  const { guideId } = await params;
  if (!CatalogSizeGuideIdSchema.safeParse(guideId).success) notFound();

  const [result, categoriesResult] = await Promise.all([
    getManagedSizeGuide(guideId),
    getManagedCategoryOptions(),
  ]);
  if ("kind" in result && result.kind === "not-found") notFound();
  if ("kind" in result || "kind" in categoriesResult) {
    const loadError = "kind" in result ? result.kind : categoriesResult.kind;
    const message =
      loadError === "unauthenticated"
        ? "Sign in with an Aaraj staff account to edit size guides."
        : loadError === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Size guide details could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Edit size guide"
            description="Define sizing by category and fit."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href={
              loadError === "unauthenticated"
                ? "/account"
                : "/admin/catalog/size-guides"
            }
          >
            {loadError === "unauthenticated"
              ? "Go to your account"
              : "Back to size guides"}
          </Link>
        </div>
      </>
    );
  }

  return (
    <SizeGuideManager
      key={result.guide.id}
      view="edit"
      initialGuide={result.guide}
      categoryOptions={categoriesResult.categories}
      query={parseCatalogSizeGuidePageQuery({})}
    />
  );
}

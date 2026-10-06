import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogSizeGuideIdSchema } from "@aaraj/contracts";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
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

  const result = await getManagedSizeGuide(guideId);
  if ("kind" in result && result.kind === "not-found") notFound();
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to edit size guides."
        : result.kind === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Size guide details could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Edit size guide
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href={
              result.kind === "unauthenticated"
                ? "/account"
                : "/admin/catalog/size-guides"
            }
          >
            {result.kind === "unauthenticated"
              ? "Go to your account"
              : "Back to size guides"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <SizeGuideManager
      view="edit"
      initialGuide={result.guide}
      query={parseCatalogSizeGuidePageQuery({})}
    />
  );
}

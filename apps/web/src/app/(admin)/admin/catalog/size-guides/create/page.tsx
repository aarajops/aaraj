import type { Metadata } from "next";
import Link from "next/link";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
  getManagedSizeGuides,
  parseCatalogSizeGuidePageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Create size guide",
  description: "Create a reusable product size guide in the Aaraj catalog.",
};

export default async function CreateSizeGuidePage() {
  const query = parseCatalogSizeGuidePageQuery({});
  const result = await getManagedSizeGuides(query);
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to create size guides."
        : result.kind === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Size guide setup could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Create size guide
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
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
              href="/admin/catalog/size-guides"
            >
              Back to size guides
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <SizeGuideManager view="create" initialPage={result.page} query={query} />
  );
}

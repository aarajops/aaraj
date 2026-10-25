import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_LIST_PAGE_SIZE } from "@aaraj/contracts";
import { DeliveryIssuesManager } from "@/features/orders/delivery-issues-manager";
import {
  getPathaoManagementIssuesForPage,
  parsePathaoIssuesPageQuery,
  type PathaoIssuesPageSearchParams,
} from "@/features/orders/pathao-queries";

export const metadata: Metadata = {
  title: "Delivery issues",
  description: "Review unmatched and conflicting Pathao events.",
};

export default async function DeliveryIssuesPage({
  searchParams,
}: {
  searchParams: Promise<PathaoIssuesPageSearchParams>;
}) {
  const query = parsePathaoIssuesPageQuery(await searchParams);
  const result = await getPathaoManagementIssuesForPage(query);
  if ("kind" in result) {
    const title =
      result.kind === "unauthenticated"
        ? "Sign in to continue"
        : result.kind === "forbidden"
          ? "Delivery issue access required"
          : "Delivery issues unavailable";
    return (
      <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
        <div className="container mx-auto">
          <p className="text-sm font-semibold tracking-widest text-primary">
            AARAJ ADMIN
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Delivery issues
          </h1>
          <section
            className="mt-6 rounded-xl border border-border p-6"
            role="alert"
          >
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-muted-foreground">
              {result.kind === "unauthenticated"
                ? "Sign in with an Aaraj staff account to review delivery exceptions."
                : result.kind === "forbidden"
                  ? "Your account cannot review delivery exceptions."
                  : "Delivery issues could not be loaded. Try again shortly."}
            </p>
            {result.kind !== "unauthenticated" && (
              <Link
                className="mt-4 inline-flex text-primary underline"
                href={issuesPageHref(query)}
              >
                Try again
              </Link>
            )}
          </section>
        </div>
      </main>
    );
  }
  return <DeliveryIssuesManager initialPage={result.value} query={query} />;
}

function issuesPageHref(query: { limit: number; offset: number }): string {
  const params = new URLSearchParams();
  if (query.limit !== DEFAULT_LIST_PAGE_SIZE) {
    params.set("limit", String(query.limit));
  }
  if (query.offset > 0) params.set("offset", String(query.offset));
  const search = params.toString();
  return search
    ? `/admin/orders/reconciliation?${search}`
    : "/admin/orders/reconciliation";
}

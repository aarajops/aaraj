import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { CustomersManager } from "@/features/customers/customers-manager";
import {
  getManagedCustomers,
  parseCustomersPageQuery,
  type CustomersPageSearchParams,
} from "@/features/customers/customers-queries";

export const metadata: Metadata = {
  title: "Customers",
  description: "Review buyers who have placed an Aaraj order.",
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<CustomersPageSearchParams>;
}) {
  const query = parseCustomersPageQuery(await searchParams);
  const result = await getManagedCustomers(query);
  if (!("page" in result)) {
    const title =
      result.kind === "unauthenticated"
        ? "Sign in to continue"
        : result.kind === "forbidden"
          ? "Customer access required"
          : "Customers unavailable";
    return (
      <div>
        <AdminPageHeader
          title="Customers"
          description="Review buyers who have placed an Aaraj order."
        />
        <Card className="mt-6" role="alert">
          <CardHeader>
            <h2 className="font-heading text-xl font-semibold">{title}</h2>
            <CardDescription>
              {result.kind === "unauthenticated"
                ? "Sign in with an Aaraj staff account to review customers."
                : result.kind === "forbidden"
                  ? "Your account cannot review customer order data."
                  : "Customer data could not be loaded. Try again shortly."}
            </CardDescription>
          </CardHeader>
          {result.kind !== "unauthenticated" && (
            <CardContent>
              <Button
                nativeButton={false}
                render={<Link href="/admin/customers" />}
              >
                Try again
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }
  return <CustomersManager initialPage={result.page} query={query} />;
}

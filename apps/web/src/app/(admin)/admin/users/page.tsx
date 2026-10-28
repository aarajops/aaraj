import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { getInitialAccess } from "@/features/auth/auth-session";
import { UsersManager } from "@/features/access/users-manager";
import {
  getManagedUsers,
  parseUsersPageQuery,
  type UsersPageSearchParams,
} from "@/features/access/users-queries";

export const metadata: Metadata = {
  title: "User management",
  description: "Review Aaraj accounts and manage staff access.",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<UsersPageSearchParams>;
}) {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("access.manage")) {
    return (
      <DirectoryNotice
        role="alert"
        title="Superadmin access required"
        description="Your account cannot view the user directory or change staff roles."
        actionLabel="Return to storefront"
        actionHref="/"
      />
    );
  }

  const query = parseUsersPageQuery(await searchParams);
  const result = await getManagedUsers(query);
  if (!("page" in result)) {
    if (result.kind === "unauthenticated") redirect("/account");
    if (result.kind === "forbidden") {
      return (
        <DirectoryNotice
          role="alert"
          title="Your access has changed"
          description="Your superadmin access changed while the directory was loading. Reload to refresh your permissions."
          actionLabel="Reload directory"
          actionHref="/admin/users"
        />
      );
    }
    return (
      <DirectoryNotice
        role="status"
        title="User directory unavailable"
        description="The directory could not be loaded. Check your connection and try again."
        actionLabel="Try again"
        actionHref="/admin/users"
      />
    );
  }

  return (
    <UsersManager
      actorId={access.userId}
      page={result.page}
      query={query}
      roleCatalog={result.roles}
    />
  );
}

function DirectoryNotice({
  role,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  role: "alert" | "status";
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <>
      <div>
        <AdminPageHeader
          title="User management"
          description="Manage accounts and staff access."
        />
        <Card
          aria-labelledby="directory-notice-title"
          className="mt-6"
          role={role}
        >
          <CardHeader>
            <h2
              className="font-heading text-xl font-semibold"
              id="directory-notice-title"
            >
              {title}
            </h2>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button nativeButton={false} render={<Link href={actionHref} />}>
              {actionLabel}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

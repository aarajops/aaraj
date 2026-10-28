import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminSkeletonProps = {
  label: string;
};

function LoadingRegion({
  label,
  children,
  className,
}: AdminSkeletonProps & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div aria-busy="true" aria-label={`Loading ${label}`} role="status">
      <div aria-hidden="true" className={className}>
        {children}
      </div>
    </div>
  );
}

function PageHeadingSkeleton({
  action = false,
  backLink = false,
}: {
  action?: boolean;
  backLink?: boolean;
}) {
  return (
    <div className="space-y-4">
      {backLink && <Skeleton aria-hidden="true" className="h-9 w-32" />}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-9 w-48 sm:h-10" />
          <Skeleton className="h-6 w-64 max-w-full" />
        </div>
        {action && <Skeleton aria-hidden="true" className="h-10 w-36" />}
      </header>
    </div>
  );
}

type AdminListVariant =
  | "products"
  | "categories"
  | "size-guides"
  | "inventory"
  | "orders"
  | "users"
  | "banners"
  | "delivery-issues";

const adminListSkeletons: Record<
  AdminListVariant,
  {
    label: string;
    columnCount: number;
    filterCount: number;
    hasAction?: boolean;
    hasSearch?: boolean;
    sortable?: boolean;
  }
> = {
  products: {
    label: "products",
    columnCount: 6,
    filterCount: 2,
    hasAction: true,
  },
  categories: {
    label: "categories",
    columnCount: 6,
    filterCount: 2,
    hasAction: true,
  },
  "size-guides": {
    label: "size guides",
    columnCount: 8,
    filterCount: 2,
    hasAction: true,
  },
  inventory: {
    label: "inventory",
    columnCount: 8,
    filterCount: 0,
  },
  orders: {
    label: "orders",
    columnCount: 11,
    filterCount: 1,
  },
  users: {
    label: "users",
    columnCount: 5,
    filterCount: 0,
  },
  banners: {
    label: "storefront banners",
    columnCount: 5,
    filterCount: 1,
    hasAction: true,
    sortable: true,
  },
  "delivery-issues": {
    label: "delivery issues",
    columnCount: 7,
    filterCount: 0,
    hasSearch: false,
  },
};

export function AdminPanelSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading admin panel"
      className="flex min-h-svh bg-background text-foreground"
      role="status"
    >
      <div aria-hidden="true" className="flex w-full">
        <aside className="hidden w-(--sidebar-width) shrink-0 border-r border-border p-4 md:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 grid gap-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-36" />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex h-14 items-center border-b border-border px-4">
            <Skeleton className="h-5 w-32" />
          </div>
          <main className="p-6">
            <div className="space-y-6">
              <PageHeadingSkeleton />
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function AdminListPageSkeleton({
  variant,
}: {
  variant: AdminListVariant;
}) {
  const {
    label,
    columnCount,
    filterCount,
    hasAction = false,
    hasSearch = true,
    sortable = false,
  } = adminListSkeletons[variant];
  return (
    <LoadingRegion className="space-y-6" label={label}>
      <PageHeadingSkeleton action={hasAction} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
          {hasSearch && <Skeleton className="h-9 min-w-60 flex-1" />}
          {Array.from({ length: filterCount }, (_, index) => (
            <Skeleton className="h-9 w-44" key={index} />
          ))}
          <Skeleton className="ml-auto h-9 w-24" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: columnCount }, (_, index) => (
                <TableHead
                  className={
                    index === 0
                      ? sortable
                        ? "w-16 px-2"
                        : "w-10 px-2"
                      : index === 1
                        ? "w-16 px-2"
                        : undefined
                  }
                  key={index}
                >
                  {index === 0 ? (
                    <Skeleton className="h-4 w-4" />
                  ) : (
                    <Skeleton className="h-4 w-24 max-w-full" />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: columnCount }, (_, index) => (
                  <TableCell
                    className={
                      index === 0
                        ? sortable
                          ? "w-16 px-2"
                          : "w-10 px-2"
                        : index === 1
                          ? "w-16 px-2"
                          : undefined
                    }
                    key={index}
                  >
                    {index === 0 ? (
                      <div className="flex items-center gap-1">
                        <Skeleton className="h-4 w-4" />
                        {sortable && <Skeleton className="h-4 w-2" />}
                      </div>
                    ) : index === 1 ? (
                      <Skeleton className="h-4 w-2" />
                    ) : (
                      <Skeleton className="h-4 w-24 max-w-full" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t border-border px-4 py-3">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AdminFormPageSkeleton({
  label,
  hasBackLink = false,
}: AdminSkeletonProps & { hasBackLink?: boolean }) {
  return (
    <LoadingRegion className="space-y-8" label={label}>
      <PageHeadingSkeleton backLink={hasBackLink} />
      <div className="grid gap-6">
        <section className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-24 w-full" />
        </section>
        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-28 w-full" />
        </section>
        <div className="flex justify-end gap-3">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AdminOverviewPageSkeleton({ label }: AdminSkeletonProps) {
  return (
    <LoadingRegion className="space-y-6" label={label}>
      <PageHeadingSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
    </LoadingRegion>
  );
}

export function AdminInvoicePageSkeleton({ label }: AdminSkeletonProps) {
  return (
    <LoadingRegion className="mx-auto max-w-3xl" label={label}>
      <div className="grid gap-6 rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
          <div className="grid gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-3 border-t border-border pt-5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AdminFormContentSkeleton({ label }: AdminSkeletonProps) {
  return (
    <LoadingRegion className="grid gap-5" label={label}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </LoadingRegion>
  );
}

"use client";

import { useMemo, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  StorefrontBanner,
  StorefrontBannerListQuery,
  StorefrontBannerPage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";
import { formatAdminDateTime } from "@/features/admin/admin-date-time";
import { Images, Plus } from "lucide-react";

const columnHelper = createDataTableColumnHelper<StorefrontBanner>();

export function StorefrontBannerTable({
  page,
  query,
}: {
  page: StorefrontBannerPage;
  query: StorefrontBannerListQuery;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "banner",
          header: "Banner",
          cell: ({ row }) => (
            <div className="flex min-w-56 items-center gap-3">
              {row.original.desktop ? (
                <Image
                  alt=""
                  className="aspect-video w-24 rounded-md border border-border object-cover"
                  height={row.original.desktop.height}
                  src={row.original.desktop.src}
                  unoptimized
                  width={row.original.desktop.width}
                />
              ) : (
                <span className="flex aspect-video w-24 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                  <Images aria-hidden="true" className="size-5" />
                </span>
              )}
              <span className="grid gap-1">
                <span className="font-medium">{row.original.name}</span>
                <span className="text-xs text-muted-foreground">
                  {row.original.mobile
                    ? "Desktop + mobile artwork"
                    : "Desktop artwork"}
                </span>
              </span>
            </div>
          ),
        }),
        columnHelper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => (
            <Badge
              className={
                row.original.active
                  ? "border-success/30 bg-success/10 text-success"
                  : ""
              }
              variant={row.original.active ? "outline" : "secondary"}
            >
              {row.original.active ? "Published" : "Draft"}
            </Badge>
          ),
        }),
        columnHelper.accessor("updatedAt", {
          header: "Updated",
          cell: ({ getValue }) =>
            getValue() ? formatAdminDateTime(getValue()!) : "Not yet updated",
        }),
        columnHelper.display({
          id: "actions",
          header: "Actions",
          meta: { align: "right" },
          cell: ({ row }) => (
            <Link
              aria-label={`Edit ${row.original.name}`}
              className={buttonVariants({ size: "lg", variant: "outline" })}
              href={`/admin/storefront/banners/${encodeURIComponent(row.original.id)}/edit`}
              prefetch={false}
            >
              Edit
            </Link>
          ),
        }),
      ]),
    [],
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="container mx-auto">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Storefront banners
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Create reusable artwork, keep unpublished versions as drafts, and
              publish slides for the storefront hero carousel.
            </p>
          </div>
          <Link
            className={buttonVariants({ size: "lg" })}
            href="/admin/storefront/banners/create"
            prefetch={false}
          >
            <Plus aria-hidden="true" />
            New banner
          </Link>
        </div>

        <section className="mt-8" aria-label="Banner records">
          <AdminDataTable
            ariaLabel="Storefront banners"
            columns={columns}
            data={page.banners}
            emptyMessage={
              query.search || query.status
                ? "No banners match the current search and filters."
                : "No banners have been created yet. Create a banner to start building the storefront banner library."
            }
            pathname="/admin/storefront/banners"
            query={query}
            itemName="banners"
            searchPlaceholder="Name or alternative text"
            filters={[
              {
                name: "status",
                label: "Status",
                allLabel: "All statuses",
                value: query.status ?? "",
                options: [
                  { value: "active", label: "Published" },
                  { value: "draft", label: "Draft" },
                ],
              },
            ]}
            onRefresh={() => startTransition(() => router.refresh())}
            isRefreshing={isPending}
            hasMore={page.hasMore}
            nextOffset={page.nextOffset}
          />
        </section>
      </div>
    </main>
  );
}

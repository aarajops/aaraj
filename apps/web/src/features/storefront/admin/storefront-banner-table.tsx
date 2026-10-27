"use client";

import { useMemo, useState, useTransition } from "react";
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
} from "@/components/admin/admin-data-table";
import { formatDateTime } from "@/lib/date-time";
import { toast } from "@/components/ui/toast";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { Images, Pencil, Plus } from "lucide-react";
import { DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import { reorderStorefrontBanners } from "@/features/storefront/admin/storefront-management-client";
import { revalidateStorefrontBanners } from "@/features/storefront/admin/storefront-banner-actions";

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
  const [bannerOrderState, setBannerOrderState] = useState({
    source: page.banners,
    banners: page.banners,
  });
  const orderedBanners =
    bannerOrderState.source === page.banners
      ? bannerOrderState.banners
      : page.banners;
  const [isReordering, setIsReordering] = useState(false);
  const canReorder =
    page.offset === 0 &&
    !page.hasMore &&
    !query.search &&
    !query.status &&
    new Set(page.banners.map(({ placement }) => placement)).size === 1 &&
    page.banners.length > 1;

  async function moveBanner(fromIndex: number, toIndex: number) {
    const next = [...orderedBanners];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setBannerOrderState({ source: page.banners, banners: next });
    setIsReordering(true);

    try {
      const response = await reorderStorefrontBanners({
        placement: next[0]!.placement,
        bannerIds: next.map(({ id }) => id),
      });
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not save the banner order.",
        );
      }
      await revalidateStorefrontBanners();
      toast.add({ title: "Banner order saved", type: "success" });
      startTransition(() => router.refresh());
    } catch (error) {
      setBannerOrderState({ source: page.banners, banners: page.banners });
      toast.add({
        title: "Could not save banner order",
        description:
          error instanceof Error ? error.message : "Please try again.",
        type: "error",
      });
      startTransition(() => router.refresh());
    } finally {
      setIsReordering(false);
    }
  }

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
            getValue() ? formatDateTime(getValue()!) : "Not yet updated",
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
            <p className="mt-2 text-sm text-muted-foreground">
              {canReorder
                ? "Drag rows to set the homepage carousel order."
                : "Reordering is available when the complete, unfiltered banner list is visible."}
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
            data={orderedBanners}
            rowActions={(banner) => (
              <DropdownMenuLinkItem
                closeOnClick
                href={`/admin/storefront/banners/${encodeURIComponent(banner.id)}/edit`}
              >
                <Pencil aria-hidden="true" className="size-4" />
                Edit banner
              </DropdownMenuLinkItem>
            )}
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
            isRefreshing={isPending || isReordering}
            page={page}
            sortableRows={
              canReorder
                ? {
                    disabled: isReordering,
                    getLabel: (banner) => banner.name,
                    onMove: (fromIndex, toIndex) =>
                      void moveBanner(fromIndex, toIndex),
                  }
                : undefined
            }
          />
        </section>
      </div>
    </main>
  );
}

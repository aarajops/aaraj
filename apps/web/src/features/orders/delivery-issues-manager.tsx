"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Eye } from "lucide-react";
import type {
  PathaoManagementIssue,
  PathaoManagementIssues,
  PathaoManagementIssuesQuery,
  PathaoWebhookResolutionInput,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenuItem,
  DropdownMenuLinkItem,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatDateTime } from "@/lib/date-time";
import { PathaoClientError, resolvePathaoWebhookIssue } from "./pathao-client";

const columnHelper = createDataTableColumnHelper<PathaoManagementIssue>();

function humanizeEvent(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function DeliveryIssuesManager({
  initialPage,
  query,
}: {
  initialPage: PathaoManagementIssues;
  query: PathaoManagementIssuesQuery;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] =
    useState<PathaoManagementIssue | null>(null);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "event",
          header: "Event",
          cell: ({ row }) => (
            <div className="grid gap-1">
              <span className="font-medium">
                {humanizeEvent(row.original.event)}
              </span>
              <Badge
                className="w-fit"
                variant={
                  row.original.status === "unmatched"
                    ? "outline"
                    : "destructive"
                }
              >
                {row.original.status === "unmatched"
                  ? "Unmatched"
                  : "Needs review"}
              </Badge>
            </div>
          ),
        }),
        columnHelper.display({
          id: "order",
          header: "Order",
          cell: ({ row }) =>
            row.original.orderId ? (
              <Link
                className="font-medium hover:underline"
                href={`/admin/orders/${row.original.orderId}`}
                prefetch={false}
              >
                {row.original.orderReference ?? "Review order"}
              </Link>
            ) : (
              <span className="text-muted-foreground">No matching order</span>
            ),
        }),
        columnHelper.display({
          id: "shipment",
          header: "Shipment",
          cell: ({ row }) => (
            <div className="grid gap-1">
              <span>{row.original.consignmentId ?? "—"}</span>
              {row.original.merchantOrderId &&
                row.original.merchantOrderId !==
                  row.original.orderReference && (
                  <span className="text-xs text-muted-foreground">
                    Merchant ref {row.original.merchantOrderId}
                  </span>
                )}
            </div>
          ),
        }),
        columnHelper.display({
          id: "providerStatus",
          header: "Provider status",
          cell: ({ row }) => (
            <div className="grid gap-1">
              <span>{row.original.providerStatus ?? "—"}</span>
              {row.original.errorCode && (
                <span className="text-xs text-muted-foreground">
                  {row.original.errorCode}
                </span>
              )}
            </div>
          ),
        }),
        columnHelper.accessor("occurredAt", {
          header: "Received",
          cell: ({ getValue }) => formatDateTime(getValue()),
        }),
      ]),
    [],
  );

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="container mx-auto">
        <header>
          <p className="text-sm font-semibold tracking-widest text-primary">
            AARAJ ADMIN
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Delivery issues
          </h1>
          <p className="mt-1 text-muted-foreground">
            Review unmatched and conflicting Pathao events.
          </p>
        </header>
        <section aria-label="Webhook exceptions" className="mt-6">
          <AdminDataTable
            ariaLabel="Webhook exceptions"
            columns={columns}
            data={initialPage.issues}
            rowActions={(issue) => {
              const canReview =
                issue.orderId && issue.status === "reconciliation_required";
              if (!issue.orderId && !canReview) return null;

              return (
                <>
                  {issue.orderId && (
                    <DropdownMenuLinkItem
                      closeOnClick
                      href={`/admin/orders/${issue.orderId}`}
                    >
                      <Eye aria-hidden="true" className="size-4" />
                      View order
                    </DropdownMenuLinkItem>
                  )}
                  {canReview && (
                    <DropdownMenuItem
                      onClick={() => {
                        setActionError(null);
                        setSelectedIssue(issue);
                      }}
                    >
                      <ClipboardCheck aria-hidden="true" className="size-4" />
                      Review event
                    </DropdownMenuItem>
                  )}
                </>
              );
            }}
            emptyMessage="No webhook exceptions need attention."
            itemName="webhook exceptions"
            onRefresh={() => {
              setActionError(null);
              router.refresh();
            }}
            isRefreshing={refreshing}
            page={initialPage}
            pathname="/admin/orders/reconciliation"
            query={query}
            searchPlaceholder={null}
          />
        </section>
      </div>
      <Sheet
        open={selectedIssue !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedIssue(null);
        }}
      >
        {selectedIssue && (
          <SheetContent
            className="w-full overflow-hidden p-0 sm:max-w-md"
            side="right"
          >
            <SheetHeader className="border-b border-border px-6 py-5 pr-14">
              <SheetTitle className="text-xl font-semibold">
                Review delivery event
              </SheetTitle>
              <SheetDescription>
                {humanizeEvent(selectedIssue.event)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-6 py-5">
              {actionError && (
                <p className="text-sm text-destructive" role="alert">
                  {actionError}
                </p>
              )}
              <WebhookResolutionActions
                key={selectedIssue.id}
                disabled={refreshing}
                issue={selectedIssue}
                onError={setActionError}
                onResolved={() => {
                  setActionError(null);
                  setSelectedIssue(null);
                  startTransition(() => router.refresh());
                }}
              />
            </div>
          </SheetContent>
        )}
      </Sheet>
    </main>
  );
}

function WebhookResolutionActions({
  issue,
  disabled,
  onResolved,
  onError,
}: {
  issue: PathaoManagementIssue;
  disabled: boolean;
  onResolved: () => void;
  onError: (error: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const commandIds = useRef(
    new Map<string, { fingerprint: string; id: string }>(),
  );

  async function resolve(action: "recheck" | "acknowledge_no_change") {
    const input: PathaoWebhookResolutionInput =
      action === "recheck"
        ? { action, reason }
        : { action, reason, verifiedInPathaoPanel: true };
    if (action === "acknowledge_no_change" && !verified) return;
    const fingerprint = JSON.stringify(input);
    let command = commandIds.current.get(action);
    if (command?.fingerprint !== fingerprint) {
      command = { fingerprint, id: crypto.randomUUID() };
      commandIds.current.set(action, command);
    }
    setPending(true);
    try {
      await resolvePathaoWebhookIssue(issue.id, input, command.id);
      onResolved();
    } catch (error) {
      onError(
        error instanceof PathaoClientError || error instanceof Error
          ? error.message
          : "The Pathao event could not be resolved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-64 space-y-3 text-left">
      <label className="grid gap-2 text-sm font-medium">
        Operator note
        <Textarea
          maxLength={500}
          minLength={3}
          placeholder="Record what you checked in Pathao."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || pending || reason.trim().length < 3}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void resolve("recheck")}
        >
          {pending ? "Saving…" : "Recheck"}
        </Button>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={verified}
            onCheckedChange={(checked) => setVerified(checked === true)}
          />
          Verified in Pathao
        </label>
        <Button
          disabled={
            disabled || pending || !verified || reason.trim().length < 3
          }
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void resolve("acknowledge_no_change")}
        >
          Acknowledge
        </Button>
      </div>
    </div>
  );
}

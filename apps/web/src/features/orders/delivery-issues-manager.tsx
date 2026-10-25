"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  PathaoManagementIssue,
  PathaoManagementIssues,
  PathaoManagementIssuesQuery,
  PathaoWebhookResolutionInput,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
        columnHelper.display({
          id: "action",
          header: "Action",
          meta: { align: "right" },
          cell: ({ row }) =>
            row.original.orderId &&
            row.original.status === "reconciliation_required" ? (
              <WebhookResolutionActions
                disabled={refreshing}
                issue={row.original}
                onError={setActionError}
                onResolved={() => {
                  setActionError(null);
                  startTransition(() => router.refresh());
                }}
              />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            ),
        }),
      ]),
    [refreshing, router],
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
        {actionError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}
        <section aria-label="Webhook exceptions" className="mt-6">
          <AdminDataTable
            ariaLabel="Webhook exceptions"
            columns={columns}
            data={initialPage.issues}
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
  const [expanded, setExpanded] = useState(false);
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

  if (!expanded) {
    return (
      <Button
        disabled={disabled || pending}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setExpanded(true)}
      >
        Review
      </Button>
    );
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  PathaoManagementIssue,
  PathaoManagementIssues,
  PathaoWebhookResolutionInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getPathaoManagementIssues,
  PathaoClientError,
  resolvePathaoWebhookIssue,
} from "./pathao-client";

export function PathaoIssuesPanel() {
  const [result, setResult] = useState<PathaoManagementIssues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await getPathaoManagementIssues());
    } catch (reason) {
      setError(
        reason instanceof PathaoClientError
          ? reason.message
          : "Pathao issues could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getPathaoManagementIssues()
      .then((issues) => {
        if (active) setResult(issues);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof PathaoClientError
            ? reason.message
            : "Pathao issues could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-label="Pathao reconciliation issues"
      className="mt-6 rounded-2xl border border-border p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Pathao reconciliation queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Unmatched provider events are not attached to Orders automatically.
          </p>
        </div>
        <Button
          disabled={loading}
          variant="outline"
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing…" : "Refresh issues"}
        </Button>
      </div>
      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading && !result ? (
        <p className="mt-4 text-sm" role="status">
          Loading Pathao issues…
        </p>
      ) : result?.issues.length ? (
        <ul className="mt-4 divide-y divide-border">
          {result.issues.map((issue) => (
            <li
              className="flex flex-wrap items-start justify-between gap-3 py-3"
              key={`${issue.kind}-${issue.id}`}
            >
              <div>
                <p className="font-medium">
                  {issue.kind === "webhook"
                    ? (issue.event ?? "Provider event")
                    : `Booking ${issue.status.replaceAll("_", " ")}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {issue.orderReference
                    ? `Order ${issue.orderReference}`
                    : "Not linked to an Order"}
                  {issue.merchantOrderId &&
                  issue.merchantOrderId !== issue.orderReference
                    ? ` · Pathao merchant ref ${issue.merchantOrderId}`
                    : ""}
                  {issue.consignmentId
                    ? ` · Consignment ${issue.consignmentId}`
                    : " · No consignment ID"}
                  {issue.storeId !== null ? ` · Store ${issue.storeId}` : ""}
                  {issue.providerStatus
                    ? ` · Pathao status ${issue.providerStatus}`
                    : ""}
                  {issue.errorCode ? ` · ${issue.errorCode}` : ""}
                </p>
              </div>
              {issue.orderId && (
                <Link
                  className="text-sm text-primary underline"
                  href={`/admin/orders/${issue.orderId}`}
                >
                  Review Order
                </Link>
              )}
              {issue.kind === "webhook" &&
                issue.orderId &&
                issue.status === "reconciliation_required" && (
                  <WebhookResolutionActions
                    disabled={loading}
                    issue={issue}
                    onError={setError}
                    onResolved={() => void refresh()}
                  />
                )}
            </li>
          ))}
        </ul>
      ) : (
        !loading && (
          <p className="mt-4 text-sm text-muted-foreground">
            No Pathao reconciliation issues.
          </p>
        )
      )}
      {result?.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          This list is limited to the oldest 200 open issues. Resolve these
          items to reveal later issues.
        </p>
      )}
    </section>
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
        : {
            action,
            reason,
            verifiedInPathaoPanel: true,
          };
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
    <div className="mt-3 w-full max-w-xl space-y-3">
      <label className="grid gap-2 text-sm font-medium">
        Operator note
        <Textarea
          maxLength={500}
          minLength={3}
          placeholder="Record what you checked; do not include customer contact or address details."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || pending || reason.trim().length < 3}
          onClick={() => void resolve("recheck")}
          variant="outline"
        >
          {pending ? "Saving…" : "Recheck with Pathao"}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={verified}
            onChange={(event) => setVerified(event.target.checked)}
            type="checkbox"
          />
          I verified this event in Pathao
        </label>
        <Button
          disabled={
            disabled || pending || !verified || reason.trim().length < 3
          }
          onClick={() => void resolve("acknowledge_no_change")}
          variant="outline"
        >
          Acknowledge without tracking change
        </Button>
      </div>
    </div>
  );
}

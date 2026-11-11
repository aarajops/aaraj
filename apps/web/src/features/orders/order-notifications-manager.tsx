"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OrderNotification } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchOrderNotifications,
  resolveOrderNotification,
} from "./orders-client";

export function OrderNotificationsManager() {
  const [rows, setRows] = useState<OrderNotification[]>([]);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchOrderNotifications()
        .then((result) => {
          if (active) setRows(result);
        })
        .catch(() => {
          if (active)
            setError(
              "SMS delivery statuses could not be loaded. Refresh the page to retry.",
            );
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function resolve(
    row: OrderNotification,
    resolution: "confirmed_sent" | "confirmed_not_sent",
  ) {
    const reason = reasonById[row.id]?.trim() ?? "";
    if (reason.length < 3) {
      setError("Add the provider-console review note before resolving an SMS.");
      return;
    }
    setPendingId(row.id);
    setError(null);
    try {
      const updated = await resolveOrderNotification(row.id, {
        commandId: crypto.randomUUID(),
        resolution,
        reason,
      });
      setRows((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch {
      setError(
        "The SMS resolution was not saved. Refresh and review the latest provider status before retrying.",
      );
    } finally {
      setPendingId(null);
    }
  }

  const exceptions = rows.filter(
    (row) => row.status === "unknown" || row.status === "failed",
  );

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Order SMS delivery</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Consent-based transactional updates use a durable outbox. Ambiguous
          provider outcomes are held here and never resent automatically. Check
          the provider console before resolving them.
        </p>
      </header>
      {error && (
        <p
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {exceptions.length === 0 ? (
        <p className="rounded-xl border border-border p-5 text-muted-foreground">
          No failed or ambiguous SMS delivery currently needs review.
        </p>
      ) : (
        <div className="grid gap-4">
          {exceptions.map((row) => (
            <article
              className="grid gap-3 rounded-xl border border-border p-4"
              key={row.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    <Link
                      className="underline"
                      href={`/admin/orders/${row.orderId}`}
                    >
                      {row.orderReference}
                    </Link>{" "}
                    · {eventLabel(row.eventKey)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {row.status} · attempts {row.attemptCount} · updated{" "}
                    {new Date(row.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full border px-3 py-1 text-sm">
                  {row.providerStatus ?? row.lastErrorCode ?? "needs review"}
                </span>
              </div>
              {row.providerMessageSid && (
                <p className="break-all text-xs text-muted-foreground">
                  Provider message {row.providerMessageSid}
                </p>
              )}
              <Textarea
                aria-label={`Provider review note for ${row.orderReference}`}
                maxLength={500}
                minLength={3}
                placeholder="Record the provider-console status and review evidence"
                value={reasonById[row.id] ?? ""}
                onChange={(event) =>
                  setReasonById((current) => ({
                    ...current,
                    [row.id]: event.target.value,
                  }))
                }
              />
              <div className="flex flex-wrap gap-2">
                {row.status === "unknown" && (
                  <Button
                    disabled={
                      pendingId === row.id ||
                      (reasonById[row.id] ?? "").trim().length < 3
                    }
                    onClick={() => void resolve(row, "confirmed_sent")}
                    variant="outline"
                  >
                    Provider confirms it was sent
                  </Button>
                )}
                {!row.providerMessageSid && (
                  <Button
                    disabled={
                      pendingId === row.id ||
                      (reasonById[row.id] ?? "").trim().length < 3
                    }
                    onClick={() => void resolve(row, "confirmed_not_sent")}
                  >
                    {pendingId === row.id
                      ? "Saving…"
                      : "Confirm not sent and retry"}
                  </Button>
                )}
              </div>
              {row.providerMessageSid && row.status === "failed" && (
                <p className="text-xs text-muted-foreground">
                  This provider message was acknowledged and later failed.
                  Review it in the provider console; this screen will not resend
                  a message with a provider SID.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      <section className="rounded-xl border border-border p-4">
        <h2 className="font-semibold">Recent transactional updates</h2>
        <div className="mt-3 overflow-x-auto">
          <table
            aria-label="Recent transactional updates"
            className="w-full min-w-[700px] text-left text-sm"
          >
            <thead>
              <tr className="border-b border-border">
                <th className="p-2">Order</th>
                <th className="p-2">Event</th>
                <th className="p-2">Status</th>
                <th className="p-2">Attempts</th>
                <th className="p-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-border" key={row.id}>
                  <td className="p-2">
                    <Link
                      className="underline"
                      href={`/admin/orders/${row.orderId}`}
                    >
                      {row.orderReference}
                    </Link>
                  </td>
                  <td className="p-2">{eventLabel(row.eventKey)}</td>
                  <td className="p-2">
                    {row.status}
                    {row.lastErrorCode ? ` · ${row.lastErrorCode}` : ""}
                  </td>
                  <td className="p-2">{row.attemptCount}</td>
                  <td className="p-2">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function eventLabel(eventKey: string): string {
  return eventKey.replace(/^order_/, "").replaceAll("_", " ");
}

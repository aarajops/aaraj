"use client";

import { useEffect, useRef, useState } from "react";
import {
  OrderReturnOriginSchema,
  ReturnInspectionGradeSchema,
  type OrderManagementDetail,
  type OrderReturnCase,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBdtPrice } from "@/lib/currency";
import {
  createOrderReturnCase,
  decideOrderReturnCase,
  fetchOrderReturnCases,
  inspectOrderReturn,
  receiveOrderReturn,
  recordOrderReturnRefund,
} from "./orders-client";

const grades = ReturnInspectionGradeSchema.options;
type Origin = (typeof OrderReturnOriginSchema.options)[number];
type Grade = (typeof grades)[number];

export function OrderReturnsPanel({
  order,
  canManageFinance,
}: {
  order: OrderManagementDetail;
  canManageFinance: boolean;
}) {
  const [cases, setCases] = useState<OrderReturnCase[]>([]);
  const [selectedOrigin, setSelectedOrigin] =
    useState<Origin>("customer_return");
  const [createReason, setCreateReason] = useState("");
  const [createQuantities, setCreateQuantities] = useState<
    Record<string, string>
  >({});
  const [actionReasons, setActionReasons] = useState<Record<string, string>>(
    {},
  );
  const [receivedQuantities, setReceivedQuantities] = useState<
    Record<string, Record<string, string>>
  >({});
  const [inspectionCounts, setInspectionCounts] = useState<
    Record<string, Record<string, Record<Grade, string>>>
  >({});
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>(
    {},
  );
  const [refundReferences, setRefundReferences] = useState<
    Record<string, string>
  >({});
  const [refundMethods, setRefundMethods] = useState<
    Record<string, "bank_transfer" | "mobile_money" | "cash">
  >({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());

  useEffect(() => {
    let active = true;
    void fetchOrderReturnCases(order.id)
      .then((result) => {
        if (active) setCases(result);
      })
      .catch((reason) => {
        if (active)
          setError(messageOf(reason, "Return cases could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [order.id]);

  const eligibleOrigins: Origin[] =
    order.fulfillmentStatus === "delivered" ||
    order.fulfillmentStatus === "partially_delivered"
      ? ["customer_return"]
      : order.fulfillmentStatus === "delivery_failed" ||
          order.fulfillmentStatus === "returned"
        ? ["courier_rts", "doorstep_refusal"]
        : [];

  const origin = eligibleOrigins.includes(selectedOrigin)
    ? selectedOrigin
    : (eligibleOrigins[0] ?? "customer_return");

  const deliveryByVariant = new Map(
    order.deliveryLines.map((line) => [line.variantId, line.quantityDelivered]),
  );

  function eligibleQuantity(
    variantId: string,
    quantity: number,
    selectedOrigin = origin,
  ) {
    const delivered = deliveryByVariant.get(variantId) ?? 0;
    return selectedOrigin === "customer_return"
      ? delivered
      : quantity - delivered;
  }

  async function runCommand<T>(
    scope: string,
    payload: unknown,
    send: (commandId: string) => Promise<T>,
    onSuccess: (result: T) => void,
  ) {
    const fingerprint = `${scope}:${JSON.stringify(payload)}`;
    const commandId =
      commandIds.current.get(fingerprint) ?? crypto.randomUUID();
    commandIds.current.set(fingerprint, commandId);
    setPending(scope);
    setError(null);
    try {
      const result = await send(commandId);
      commandIds.current.delete(fingerprint);
      onSuccess(result);
    } catch (reason) {
      setError(
        messageOf(
          reason,
          "The return operation could not be saved. Retry the same details.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  function applyCase(updated: OrderReturnCase) {
    setCases((current) =>
      [updated, ...current.filter((entry) => entry.id !== updated.id)].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }

  async function createCase() {
    const lines = order.lines
      .map((line) => ({
        variantId: line.variantId,
        quantity: Number(createQuantities[line.variantId] ?? "0"),
      }))
      .filter((line) => line.quantity > 0);
    await runCommand(
      `create:${order.id}`,
      { origin, reason: createReason, lines },
      (commandId) =>
        createOrderReturnCase(order.id, {
          commandId,
          origin,
          reason: createReason,
          lines,
        }),
      (result) => {
        applyCase(result);
        setCreateReason("");
        setCreateQuantities({});
      },
    );
  }

  function setCaseReason(caseId: string, value: string) {
    setActionReasons((current) => ({ ...current, [caseId]: value }));
  }

  async function decideCase(
    entry: OrderReturnCase,
    decision: "authorize" | "reject",
  ) {
    const reason = actionReasons[entry.id] ?? "";
    await runCommand(
      `decision:${entry.id}`,
      { decision, reason },
      (commandId) =>
        decideOrderReturnCase(entry.id, { commandId, decision, reason }),
      applyCase,
    );
  }

  async function receiveCase(entry: OrderReturnCase) {
    const lines = entry.lines.map((line) => ({
      variantId: line.variantId,
      quantityReceived: Number(
        receivedQuantities[entry.id]?.[line.variantId] ??
          String(line.requestedQuantity),
      ),
    }));
    const reason = actionReasons[entry.id] ?? "";
    await runCommand(
      `receive:${entry.id}`,
      { reason, lines },
      (commandId) => receiveOrderReturn(entry.id, { commandId, reason, lines }),
      applyCase,
    );
  }

  async function inspectCase(entry: OrderReturnCase) {
    const restockIds = new Map<string, string>();
    const lines = entry.lines.map((line) => {
      const counts = inspectionCounts[entry.id]?.[line.variantId];
      const lineGrades = grades
        .map((grade) => ({
          grade,
          quantity: Number(
            counts?.[grade] ??
              (grade === "sellable" ? line.receivedQuantity : 0),
          ),
        }))
        .filter((grade) => grade.quantity > 0);
      const sellableQuantity =
        lineGrades.find((grade) => grade.grade === "sellable")?.quantity ?? 0;
      const restockCommandId =
        sellableQuantity > 0
          ? (commandIds.current.get(`restock:${entry.id}:${line.variantId}`) ??
            crypto.randomUUID())
          : undefined;
      if (restockCommandId) {
        commandIds.current.set(
          `restock:${entry.id}:${line.variantId}`,
          restockCommandId,
        );
        restockIds.set(line.variantId, restockCommandId);
      }
      return {
        variantId: line.variantId,
        grades: lineGrades,
        ...(restockCommandId ? { restockCommandId } : {}),
      };
    });
    const reason = actionReasons[entry.id] ?? "";
    await runCommand(
      `inspect:${entry.id}`,
      { reason, lines },
      (commandId) => inspectOrderReturn(entry.id, { commandId, reason, lines }),
      (result) => {
        for (const [variantId, commandId] of restockIds) {
          if (
            commandIds.current.get(`restock:${entry.id}:${variantId}`) ===
            commandId
          ) {
            commandIds.current.delete(`restock:${entry.id}:${variantId}`);
          }
        }
        applyCase(result);
      },
    );
  }

  async function refundCase(entry: OrderReturnCase) {
    const amountBdt = Number(
      refundAmounts[entry.id] ?? String(entry.maximumRefundAmountBdt),
    );
    const reference = refundReferences[entry.id]?.trim();
    const reason = actionReasons[entry.id] ?? "";
    const method = refundMethods[entry.id] ?? "bank_transfer";
    await runCommand(
      `refund:${entry.id}`,
      { amountBdt, method, reference, reason },
      (commandId) =>
        recordOrderReturnRefund(entry.id, {
          commandId,
          amountBdt,
          method,
          ...(reference ? { reference } : {}),
          reason,
        }),
      applyCase,
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Returns and returned goods</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Record customer returns, courier returns, physical receipt, inspection,
        and any verified refund. Only units graded sellable return to available
        stock.
      </p>
      {eligibleOrigins.length > 0 && (
        <div className="mt-5 grid gap-4 rounded-xl border border-border p-4">
          <h3 className="font-semibold">Open a return case</h3>
          <label className="grid gap-2 text-sm font-medium">
            Return type
            <select
              className="h-10 rounded-md border border-input bg-background px-3"
              value={origin}
              onChange={(event) =>
                setSelectedOrigin(event.target.value as Origin)
              }
            >
              {eligibleOrigins.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          {order.lines.map((line) => {
            const max = eligibleQuantity(line.variantId, line.quantity);
            if (max <= 0) return null;
            return (
              <label
                className="grid grid-cols-[1fr_7rem] items-center gap-3 text-sm"
                key={line.variantId}
              >
                <span>
                  {line.productName} · {line.color} · {line.sizeLabel}{" "}
                  <span className="text-muted-foreground">
                    (eligible {max})
                  </span>
                </span>
                <Input
                  aria-label={`Return quantity: ${line.productName}`}
                  inputMode="numeric"
                  min={0}
                  max={max}
                  type="number"
                  value={createQuantities[line.variantId] ?? "0"}
                  onChange={(event) =>
                    setCreateQuantities((current) => ({
                      ...current,
                      [line.variantId]: event.target.value,
                    }))
                  }
                />
              </label>
            );
          })}
          <label className="grid gap-2 text-sm font-medium">
            Case reason
            <Textarea
              maxLength={500}
              minLength={3}
              value={createReason}
              onChange={(event) => setCreateReason(event.target.value)}
            />
          </label>
          <Button
            disabled={
              Boolean(pending) ||
              createReason.trim().length < 3 ||
              !order.lines.some(
                (line) => Number(createQuantities[line.variantId] ?? 0) > 0,
              )
            }
            onClick={() => void createCase()}
          >
            {pending === `create:${order.id}` ? "Saving…" : "Open return case"}
          </Button>
        </div>
      )}
      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 grid gap-4">
        {cases.map((entry) => {
          const busy = pending?.endsWith(entry.id) ?? false;
          const reason = actionReasons[entry.id] ?? "";
          return (
            <article
              className="grid gap-4 rounded-xl border border-border p-4"
              key={entry.id}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {label(entry.origin)} · {label(entry.status)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opened {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {entry.reason}
                  </p>
                </div>
                {entry.origin === "customer_return" && (
                  <p className="text-sm">
                    Refund cap:{" "}
                    {formatBdtPrice({
                      amountBdt: entry.maximumRefundAmountBdt,
                    })}
                  </p>
                )}
              </header>
              <ul className="grid gap-2 text-sm">
                {entry.lines.map((line) => (
                  <li
                    className="flex flex-wrap justify-between gap-2 border-t border-border pt-2"
                    key={line.variantId}
                  >
                    <span>
                      {line.productName} · {line.color} · {line.sizeLabel} ·
                      requested {line.requestedQuantity}, received{" "}
                      {line.receivedQuantity}
                    </span>
                    <span>
                      {line.inspections
                        .map(
                          (inspection) =>
                            `${label(inspection.grade)} ${inspection.quantity}`,
                        )
                        .join(" · ") || "Not inspected"}
                    </span>
                  </li>
                ))}
              </ul>
              {entry.status === "requested" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={Boolean(pending) || reason.trim().length < 3}
                    onClick={() => void decideCase(entry, "authorize")}
                  >
                    Authorize
                  </Button>
                  <Button
                    disabled={Boolean(pending) || reason.trim().length < 3}
                    onClick={() => void decideCase(entry, "reject")}
                    variant="outline"
                  >
                    Reject
                  </Button>
                </div>
              )}
              {entry.status === "authorized" &&
                entry.lines.map((line) => (
                  <label
                    className="grid grid-cols-[1fr_7rem] items-center gap-3 text-sm"
                    key={line.variantId}
                  >
                    <span>
                      Quantity physically received: {line.productName} (max{" "}
                      {line.requestedQuantity})
                    </span>
                    <Input
                      aria-label={`Received quantity: ${line.productName}`}
                      min={0}
                      max={line.requestedQuantity}
                      type="number"
                      value={
                        receivedQuantities[entry.id]?.[line.variantId] ??
                        String(line.requestedQuantity)
                      }
                      onChange={(event) =>
                        setReceivedQuantities((current) => ({
                          ...current,
                          [entry.id]: {
                            ...current[entry.id],
                            [line.variantId]: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              {entry.status === "authorized" && (
                <Button
                  disabled={Boolean(pending) || reason.trim().length < 3}
                  onClick={() => void receiveCase(entry)}
                >
                  Record receipt
                </Button>
              )}
              {entry.status === "received" &&
                entry.lines.map((line) => (
                  <fieldset
                    className="grid gap-2 rounded-lg border border-border p-3"
                    key={line.variantId}
                  >
                    <legend className="px-1 text-sm font-medium">
                      Inspect {line.productName} · received{" "}
                      {line.receivedQuantity}
                    </legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {grades.map((grade) => (
                        <label className="grid gap-1 text-xs" key={grade}>
                          {label(grade)}
                          <Input
                            aria-label={`${label(grade)} units: ${line.productName}`}
                            min={0}
                            max={line.receivedQuantity}
                            type="number"
                            value={
                              inspectionCounts[entry.id]?.[line.variantId]?.[
                                grade
                              ] ??
                              String(
                                grade === "sellable"
                                  ? line.receivedQuantity
                                  : 0,
                              )
                            }
                            onChange={(event) =>
                              setInspectionCounts((current) => ({
                                ...current,
                                [entry.id]: {
                                  ...current[entry.id],
                                  [line.variantId]: {
                                    sellable: "0",
                                    repairable: "0",
                                    damaged: "0",
                                    fraud_review: "0",
                                    ...current[entry.id]?.[line.variantId],
                                    [grade]: event.target.value,
                                  },
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              {entry.status === "received" && (
                <Button
                  disabled={Boolean(pending) || reason.trim().length < 3}
                  onClick={() => void inspectCase(entry)}
                >
                  Save inspection
                </Button>
              )}
              {entry.status === "refund_pending" &&
                (canManageFinance ? (
                  <div className="grid gap-3 rounded-lg border border-border p-3">
                    <p className="text-sm">
                      Verified collection recorded on order:{" "}
                      {formatBdtPrice({
                        amountBdt: order.collectedAmountBdt ?? 0,
                      })}{" "}
                      · return value cap:{" "}
                      {formatBdtPrice({
                        amountBdt: entry.maximumRefundAmountBdt,
                      })}
                    </p>
                    <Input
                      aria-label="Refund amount in BDT"
                      inputMode="numeric"
                      min={0}
                      max={entry.maximumRefundAmountBdt}
                      type="number"
                      value={
                        refundAmounts[entry.id] ??
                        String(entry.maximumRefundAmountBdt)
                      }
                      onChange={(event) =>
                        setRefundAmounts((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <select
                      aria-label="Refund method"
                      className="h-10 rounded-md border border-input bg-background px-3"
                      value={refundMethods[entry.id] ?? "bank_transfer"}
                      onChange={(event) =>
                        setRefundMethods((current) => ({
                          ...current,
                          [entry.id]: event.target.value as
                            "bank_transfer" | "mobile_money" | "cash",
                        }))
                      }
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="mobile_money">Mobile money</option>
                      <option value="cash">Cash</option>
                    </select>
                    <Input
                      aria-label="Refund transfer reference"
                      maxLength={160}
                      placeholder="Transfer or receipt reference"
                      value={refundReferences[entry.id] ?? ""}
                      onChange={(event) =>
                        setRefundReferences((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      disabled={Boolean(pending) || reason.trim().length < 3}
                      onClick={() => void refundCase(entry)}
                    >
                      Record verified refund
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Finance permission is required to record a refund.
                  </p>
                ))}
              {entry.status === "refunded" && (
                <p className="text-sm">
                  Refund recorded:{" "}
                  {formatBdtPrice({ amountBdt: entry.refundAmountBdt ?? 0 })}
                </p>
              )}
              {[
                "requested",
                "authorized",
                "received",
                "refund_pending",
              ].includes(entry.status) && (
                <label className="grid gap-2 text-sm font-medium">
                  Action reason
                  <textarea
                    className="min-h-20 rounded-md border border-input bg-background p-3"
                    maxLength={500}
                    minLength={3}
                    value={reason}
                    onChange={(event) =>
                      setCaseReason(entry.id, event.target.value)
                    }
                  />
                </label>
              )}
              {busy && (
                <p className="text-sm text-muted-foreground" role="status">
                  Saving return case…
                </p>
              )}
            </article>
          );
        })}
        {cases.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No return cases are recorded for this order.
          </p>
        )}
      </div>
    </section>
  );
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function messageOf(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

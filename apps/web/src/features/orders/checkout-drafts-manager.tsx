"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BangladeshGeography,
  CheckoutAddressInput,
  CheckoutDraftDetail,
  CheckoutDraftList,
  CheckoutDraftListQuery,
  CheckoutDraftOutcomeInput,
  CheckoutDraftPreview,
} from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { fetchBangladeshGeography } from "@/features/cart/quote-client";
import {
  createCheckoutDraftOrder,
  fetchCheckoutDraft,
  previewCheckoutDraft,
  saveCallOutcome,
} from "./checkout-drafts-client";

type DraftRow = CheckoutDraftList["rows"][number];
const columns = createDataTableColumnHelper<DraftRow>();

export function CheckoutDraftsManager({
  page,
  query,
}: {
  page: CheckoutDraftList;
  query: CheckoutDraftListQuery;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tableColumns = useMemo(
    () =>
      columns.columns([
        columns.display({
          id: "draft",
          header: "Checkout",
          cell: ({ row }) => (
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => setSelectedId(row.original.id)}
            >
              {row.original.id.slice(0, 8).toUpperCase()}
            </Button>
          ),
        }),
        columns.accessor("lastCustomerActivityAt", {
          header: "Last activity",
          cell: ({ getValue }) => formatDateTime(getValue()),
        }),
        columns.display({
          id: "customer",
          header: "Customer",
          cell: ({ row }) => (
            <div>
              <div className="font-medium">{row.original.customerName}</div>
              <div className="text-sm text-muted-foreground">
                {row.original.maskedPhone}
              </div>
            </div>
          ),
        }),
        columns.display({
          id: "items",
          header: "Items",
          meta: { className: "min-w-52 max-w-64 whitespace-normal" },
          cell: ({ row }) => (
            <div>
              {row.original.items[0]?.productName ?? "No items"}
              {row.original.items.length > 1 && (
                <span className="block text-xs text-muted-foreground">
                  +{row.original.items.length - 1} more
                </span>
              )}
            </div>
          ),
        }),
        columns.display({
          id: "pieces",
          header: "Pieces",
          meta: { align: "right", numeric: true },
          cell: ({ row }) =>
            row.original.items.reduce((sum, item) => sum + item.quantity, 0),
        }),
        columns.accessor("deliveryZone", {
          header: "Zone",
          cell: ({ getValue }) => getValue()?.replaceAll("_", " ") ?? "—",
        }),
        columns.accessor("outcome", {
          header: "Call outcome",
          cell: ({ getValue }) => getValue().replaceAll("_", " "),
        }),
        columns.accessor("estimatedTotalBdt", {
          header: "Estimate",
          meta: { align: "right", numeric: true },
          cell: ({ getValue }) =>
            getValue() === null
              ? "—"
              : formatBdtPrice({ amountBdt: getValue()! }),
        }),
      ]),
    [],
  );

  return (
    <>
      <AdminPageHeader
        title="Abandoned checkouts"
        description="Call customers and create a confirmed COD Order after they agree to the current total."
      />
      <AdminDataTable
        className="mt-6"
        ariaLabel="Abandoned checkouts"
        columns={tableColumns}
        data={page.rows}
        pathname="/admin/orders/abandoned"
        query={query}
        itemName="checkouts"
        searchPlaceholder={null}
        onRefresh={() => router.refresh()}
        page={page}
        emptyMessage="No abandoned checkouts are ready for review."
      />
      {selectedId && (
        <CheckoutDraftSheet
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => router.refresh()}
        />
      )}
    </>
  );
}

function CheckoutDraftSheet({
  id,
  onClose,
  onUpdated,
}: {
  id: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<CheckoutDraftDetail | null>(null);
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] =
    useState<CheckoutDraftOutcomeInput["outcome"]>("interested");
  const [callbackAt, setCallbackAt] = useState("");
  const [form, setForm] = useState({
    recipientName: "",
    phone: "",
    doorstepDetails: "",
    divisionId: "",
    districtId: "",
    upazilaId: "",
  });
  const [preview, setPreview] = useState<CheckoutDraftPreview | null>(null);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchCheckoutDraft(id), fetchBangladeshGeography()])
      .then(([draft, locations]) => {
        if (!active) return;
        setDetail(draft);
        setGeography(locations);
        setForm({
          recipientName:
            draft.customerName === "Name not entered" ? "" : draft.customerName,
          phone: draft.phone,
          doorstepDetails: draft.doorstepDetails,
          divisionId:
            draft.destination?.geographyVersion === locations.datasetVersion
              ? draft.destination.divisionId
              : "",
          districtId:
            draft.destination?.geographyVersion === locations.datasetVersion
              ? draft.destination.districtId
              : "",
          upazilaId:
            draft.destination?.geographyVersion === locations.datasetVersion
              ? (draft.destination.upazilaId ?? "")
              : "",
        });
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load checkout details.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const divisions =
    geography?.locations.filter((item) => item.level === "division") ?? [];
  const districts =
    geography?.locations.filter(
      (item) => item.level === "district" && item.parentId === form.divisionId,
    ) ?? [];
  const upazilas =
    geography?.locations.filter(
      (item) => item.level === "upazila" && item.parentId === form.districtId,
    ) ?? [];

  function changeForm(change: Partial<typeof form>) {
    setForm((old) => ({ ...old, ...change }));
    setPreview(null);
    setAgreed(false);
  }

  function address(): CheckoutAddressInput {
    if (!geography || !form.divisionId || !form.districtId)
      throw new Error("Choose a delivery division and district.");
    return {
      recipientName: form.recipientName,
      phone: form.phone,
      doorstepDetails: form.doorstepDetails,
      geographyVersion: geography.datasetVersion,
      divisionId: form.divisionId,
      districtId: form.districtId,
      ...(form.upazilaId ? { upazilaId: form.upazilaId } : {}),
    };
  }

  async function recordOutcome() {
    if (!id || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveCallOutcome(id, {
        outcome,
        expectedVersion: detail.version,
        ...(outcome === "call_back" && callbackAt
          ? { callbackAt: new Date(callbackAt).toISOString() }
          : {}),
      });
      setDetail(next);
      setPreview(null);
      setAgreed(false);
      onUpdated();
      if (outcome === "declined" || outcome === "do_not_contact") onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save call outcome.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!id || !detail || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setAgreed(false);
    try {
      setPreview(
        await previewCheckoutDraft(id, {
          address: address(),
          expectedVersion: detail.version,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not calculate the current total.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (!id || !detail || !preview || !agreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCheckoutDraftOrder(id, {
        address: address(),
        expectedVersion: detail.version,
        acceptedTotalBdt: preview.totalBdt,
        previewFingerprint: preview.fingerprint,
        customerAgreed: true,
      });
      onClose();
      onUpdated();
      router.push(
        `/admin/orders?search=${encodeURIComponent(created.reference)}`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the Order.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="gap-0 overflow-y-auto p-6 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Abandoned checkout</SheetTitle>
          <SheetDescription>
            Review, call, and confirm current Order details.
          </SheetDescription>
        </SheetHeader>
        {loading && (
          <p className="mt-6 text-sm text-muted-foreground">
            Loading checkout…
          </p>
        )}
        {error && (
          <p
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
            role="alert"
          >
            {error}
          </p>
        )}
        {detail && (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-2 text-sm">
              <p>
                <strong>Last activity:</strong>{" "}
                {formatDateTime(detail.lastCustomerActivityAt)}
              </p>
              <p>
                <strong>Phone:</strong>{" "}
                <a className="underline" href={`tel:${detail.phone}`}>
                  {detail.phone}
                </a>
              </p>
              <p>
                <strong>Call outcome:</strong>{" "}
                {detail.outcome.replaceAll("_", " ")} ({detail.attemptCount}{" "}
                attempts)
              </p>
              <div>
                <strong>Saved items</strong>
                <ul className="mt-1 list-inside list-disc">
                  {detail.items.map((item) => (
                    <li key={item.variantId}>
                      {item.productName} · {item.color} · {item.sizeLabel} ×{" "}
                      {item.quantity}
                    </li>
                  ))}
                </ul>
              </div>
              <p>
                <strong>Saved estimate:</strong>{" "}
                {detail.estimatedTotalBdt === null
                  ? "Not available"
                  : formatBdtPrice({ amountBdt: detail.estimatedTotalBdt })}
              </p>
            </section>
            <section className="grid gap-3 border-t pt-5">
              <h3 className="font-semibold">Record call</h3>
              <select
                className="h-10 rounded-md border border-input bg-background px-3"
                value={outcome}
                onChange={(event) =>
                  setOutcome(
                    event.target.value as CheckoutDraftOutcomeInput["outcome"],
                  )
                }
              >
                <option value="interested">Interested</option>
                <option value="no_answer">No answer</option>
                <option value="call_back">Call back</option>
                <option value="declined">Declined</option>
                <option value="do_not_contact">Do not contact</option>
              </select>
              {outcome === "call_back" && (
                <Input
                  aria-label="Callback time"
                  type="datetime-local"
                  value={callbackAt}
                  onChange={(event) => setCallbackAt(event.target.value)}
                />
              )}
              <Button
                disabled={busy}
                onClick={() => void recordOutcome()}
                type="button"
                variant="outline"
              >
                Save call outcome
              </Button>
            </section>
            {detail.outcome === "interested" && (
              <section className="grid gap-3 border-t pt-5">
                <h3 className="font-semibold">Prepare confirmed Order</h3>
                <label className="grid gap-1 text-sm">
                  Recipient name
                  <Input
                    maxLength={120}
                    value={form.recipientName}
                    onChange={(event) =>
                      changeForm({ recipientName: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Phone
                  <Input
                    maxLength={32}
                    value={form.phone}
                    onChange={(event) =>
                      changeForm({ phone: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Division
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3"
                    value={form.divisionId}
                    onChange={(event) =>
                      changeForm({
                        divisionId: event.target.value,
                        districtId: "",
                        upazilaId: "",
                      })
                    }
                  >
                    <option value="">Choose division</option>
                    {divisions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  District
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3"
                    value={form.districtId}
                    onChange={(event) =>
                      changeForm({
                        districtId: event.target.value,
                        upazilaId: "",
                      })
                    }
                  >
                    <option value="">Choose district</option>
                    {districts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {upazilas.length > 0 && (
                  <label className="grid gap-1 text-sm">
                    Upazila
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3"
                      value={form.upazilaId}
                      onChange={(event) =>
                        changeForm({ upazilaId: event.target.value })
                      }
                    >
                      <option value="">Choose if applicable</option>
                      {upazilas.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="grid gap-1 text-sm">
                  Delivery address
                  <Textarea
                    maxLength={400}
                    value={form.doorstepDetails}
                    onChange={(event) =>
                      changeForm({ doorstepDetails: event.target.value })
                    }
                  />
                </label>
                <Button
                  disabled={busy}
                  onClick={() => void prepare()}
                  type="button"
                  variant="outline"
                >
                  Check current price and stock
                </Button>
                {preview && (
                  <div className="grid gap-3 rounded-lg border p-4 text-sm">
                    <strong>
                      Current COD total:{" "}
                      {formatBdtPrice({ amountBdt: preview.totalBdt })}
                    </strong>
                    <p>
                      Items:{" "}
                      {formatBdtPrice({
                        amountBdt: preview.merchandiseGrossBdt,
                      })}{" "}
                      · Delivery:{" "}
                      {formatBdtPrice({ amountBdt: preview.deliveryAmountBdt })}
                    </p>
                    <p>
                      Confirm the items, address, delivery fee, and final total
                      with the customer before creating the Order.
                    </p>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(event) => setAgreed(event.target.checked)}
                      />
                      The customer agreed to this final COD total.
                    </label>
                    <Button
                      disabled={busy || !agreed}
                      onClick={() => void createOrder()}
                      type="button"
                    >
                      Create confirmed Order
                    </Button>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

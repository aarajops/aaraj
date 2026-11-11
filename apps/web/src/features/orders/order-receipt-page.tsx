"use client";

import { useEffect, useState } from "react";
import type { OrderManagementDetail, OrderReceipt } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { OrderInvoice } from "./order-invoice";
import {
  OrderRequestError,
  fetchOrderReceipt,
  issueOrderReceipt,
} from "./orders-client";

export function OrderReceiptPage({
  order,
  autoPrint,
}: {
  order: OrderManagementDetail;
  autoPrint: boolean;
}) {
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchOrderReceipt(order.id)
      .then((result) => {
        if (active) setReceipt(result);
      })
      .catch((reason) => {
        if (
          active &&
          !(reason instanceof OrderRequestError && reason.status === 404)
        ) {
          setError(
            reason instanceof Error
              ? reason.message
              : "The delivery receipt could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [order.id]);

  async function issueReceipt() {
    setPending(true);
    setError(null);
    try {
      setReceipt(await issueOrderReceipt(order.id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The delivery receipt could not be issued.",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading saved delivery receipt…
      </p>
    );
  if (receipt) return <OrderInvoice autoPrint={autoPrint} receipt={receipt} />;
  const eligible =
    order.status === "confirmed" &&
    ["delivered", "returned"].includes(order.fulfillmentStatus);
  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-border p-6">
      <h1 className="text-xl font-semibold">Delivery receipt</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The saved receipt uses an immutable order snapshot and a unique sequence
        number. It is not a tax invoice.
      </p>
      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {eligible ? (
        <Button
          className="mt-5"
          disabled={pending}
          onClick={() => void issueReceipt()}
        >
          {pending ? "Issuing…" : "Issue durable delivery receipt"}
        </Button>
      ) : (
        <p
          className="mt-5 rounded-lg border border-border p-4 text-sm"
          role="status"
        >
          A delivery receipt becomes available after the Order is fully
          delivered. This page will not issue a Mushak 6.3 VAT tax invoice.
        </p>
      )}
    </section>
  );
}

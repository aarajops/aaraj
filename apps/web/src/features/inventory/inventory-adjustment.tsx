"use client";

import { useRef, useState, useTransition, type SubmitEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  InventoryAdjustmentInputSchema,
  InventoryAdjustmentResultSchema,
  type InventoryAdjustmentInput,
  type InventoryVariant,
} from "@aaraj/contracts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { createInventoryAdjustment } from "./inventory-client";

type Direction = "receive" | "remove";

export function InventoryAdjustment({
  variant,
}: {
  variant: InventoryVariant;
}) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const submissionLock = useRef(false);
  const [direction, setDirection] = useState<Direction>("receive");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<InventoryAdjustmentInput | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `aaraj/inventory-adjustment/${variant.id}`;

  async function submitAdjustment(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current || isSubmitting) return;
    setError(null);

    const draft = InventoryAdjustmentInputSchema.pick({
      delta: true,
      reason: true,
    }).safeParse({
      delta: direction === "receive" ? Number(quantity) : -Number(quantity),
      reason,
    });
    if (!draft.success) {
      setError(
        "Enter a whole quantity greater than zero and a reason of at least 3 characters.",
      );
      return;
    }

    const previous = pending ?? readPendingCommand(storageKey);
    if (
      previous &&
      (previous.delta !== draft.data.delta ||
        previous.reason !== draft.data.reason)
    ) {
      setError(
        "A previous adjustment has an unconfirmed result. Re-enter its same direction, quantity, and reason, then retry it before starting another adjustment.",
      );
      return;
    }
    const command = previous ?? {
      ...draft.data,
      commandId: crypto.randomUUID(),
    };
    submissionLock.current = true;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(command));
    } catch {
      submissionLock.current = false;
      setError(
        "Browser session storage is unavailable, so this adjustment was not sent. Enable session storage and try again to keep retries safe.",
      );
      return;
    }
    setPending(command);

    setIsSubmitting(true);
    try {
      const response = await createInventoryAdjustment(variant.id, command);
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        const apiMessage = getApiErrorMessage(problem);
        if (
          response.status >= 500 ||
          response.status === 401 ||
          response.status === 403
        ) {
          setError(
            apiMessage ?? "The API returned an unreadable error response.",
          );
        } else {
          clearPendingCommand(storageKey);
          setPending(null);
          setError(
            apiMessage ?? "The API returned an unreadable error response.",
          );
        }
        return;
      }

      const result = InventoryAdjustmentResultSchema.safeParse(
        await response.json(),
      );
      if (
        !result.success ||
        result.data.commandId !== command.commandId ||
        result.data.variantId !== variant.id ||
        result.data.delta !== command.delta
      ) {
        setError(
          "The adjustment may have completed, but its response could not be confirmed. Retry the same adjustment.",
        );
        return;
      }

      clearPendingCommand(storageKey);
      setPending(null);
      startTransition(() => router.replace("/admin/inventory"));
    } catch {
      setError(
        "The connection ended before the result was confirmed. Retry this same adjustment before starting another one.",
      );
    } finally {
      setIsSubmitting(false);
      submissionLock.current = false;
    }
  }

  const locked = isSubmitting || pending !== null;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link
          className={buttonVariants({ variant: "link" })}
          href="/admin/inventory"
        >
          ← Back to inventory
        </Link>
        <p className="mt-7 text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Adjust stock
        </h1>
        <p className="mt-2 text-muted-foreground">
          {variant.productName} · {variant.color} · {variant.sizeLabel} · SKU{" "}
          {variant.sku}
        </p>

        <Card className="mt-7 gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7">
          <p className="text-sm text-muted-foreground">
            Current on-hand quantity
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {variant.quantityOnHand}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reserved: {variant.quantityReserved} · Available:{" "}
            {variant.quantityAvailable}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            This records stock corrections and receipts. Stock already reserved
            by an active reservation cannot be removed until that reservation is
            released or consumed.
          </p>

          {error && (
            <p
              className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <form className="mt-6 grid gap-5" onSubmit={submitAdjustment}>
            <fieldset disabled={locked} className="grid gap-4">
              <legend className="text-sm font-medium">Adjustment</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg border border-input p-3 text-sm">
                  <input
                    checked={direction === "receive"}
                    name="direction"
                    type="radio"
                    value="receive"
                    onChange={() => setDirection("receive")}
                  />
                  Receive stock
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-input p-3 text-sm">
                  <input
                    checked={direction === "remove"}
                    name="direction"
                    type="radio"
                    value="remove"
                    onChange={() => setDirection("remove")}
                  />
                  Remove stock
                </label>
              </div>

              <Field>
                <FieldLabel htmlFor="quantity">Units</FieldLabel>
                <Input
                  id="quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="2147483647"
                  step="1"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="reason">Reason</FieldLabel>
                <Textarea
                  id="reason"
                  maxLength={500}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <FieldDescription>
                  Record the stock reason only; do not include customer personal
                  information.
                </FieldDescription>
              </Field>
            </fieldset>

            <Button
              className="w-full sm:w-auto sm:justify-self-start"
              disabled={isSubmitting || isNavigating}
              type="submit"
            >
              {isSubmitting
                ? "Saving adjustment…"
                : pending
                  ? "Retry same adjustment"
                  : direction === "receive"
                    ? "Receive stock"
                    : "Remove stock"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

function readPendingCommand(
  storageKey: string,
): InventoryAdjustmentInput | null {
  try {
    const saved = window.sessionStorage.getItem(storageKey);
    if (!saved) return null;
    const parsed = InventoryAdjustmentInputSchema.safeParse(JSON.parse(saved));
    if (parsed.success) return parsed.data;
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
  return null;
}

function clearPendingCommand(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

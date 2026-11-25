"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BANGLADESH_GEOGRAPHY_VERSION,
  CheckoutAddressInputSchema,
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
  ManualOrderCustomerSchema,
  ManualOrderInputSchema,
  type BangladeshGeography,
  type ManualOrderCustomer,
  type ManualOrderInput,
  type ManualOrderPreview,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchBangladeshGeography } from "@/features/cart/quote-client";
import { searchManualOrderAccounts } from "@/features/customers/customers-client";
import { formatBdtPrice } from "@/lib/currency";
import {
  createManualOrder,
  OrderRequestError,
  previewManualOrder,
} from "./orders-client";
import {
  ManualOrderCatalogPicker,
  type ManualVariantLine,
} from "./manual-order-catalog-picker";

const manualVariantLineFormSchema =
  ManualOrderInputSchema.shape.lines.element.extend({
    productId: z.uuid(),
    productName: z.string().min(1),
    color: z.string().min(1),
    sizeLabel: z.string().min(1),
    unitPriceBdt: z.number().int().nonnegative(),
  });

const manualComboLineFormSchema =
  ManualOrderInputSchema.shape.combos.element.extend({
    productName: z.string().min(1),
    unitPriceBdt: z.number().int().nonnegative(),
  });

const manualOrderFormSchema = z.object({
  selectedCustomer: ManualOrderCustomerSchema.nullable(),
  address: z.object({
    recipientName: CheckoutAddressInputSchema.shape.recipientName,
    phone: CheckoutAddressInputSchema.shape.phone,
    divisionId: z.string().min(1, "Choose a division.").pipe(z.uuid()),
    districtId: z.string().min(1, "Choose a district.").pipe(z.uuid()),
    upazilaId: z.union([z.literal(""), z.uuid()]),
    doorstepDetails: CheckoutAddressInputSchema.shape.doorstepDetails,
  }),
  lines: z.array(manualVariantLineFormSchema).max(MAX_CART_LINES),
  combos: z.array(manualComboLineFormSchema).max(MAX_CART_LINES),
});

type ManualOrderFormValues = z.infer<typeof manualOrderFormSchema>;
type AddressDraft = ManualOrderFormValues["address"];

type PreviewState = {
  requestKey: string;
  value: ManualOrderPreview;
};

const emptyAddress: AddressDraft = {
  recipientName: "",
  phone: "",
  divisionId: "",
  districtId: "",
  upazilaId: "",
  doorstepDetails: "",
};

const emptyManualOrderForm: ManualOrderFormValues = {
  selectedCustomer: null,
  address: emptyAddress,
  lines: [],
  combos: [],
};

export function ManualOrderForm() {
  const router = useRouter();
  const {
    control,
    getValues,
    handleSubmit,
    register,
    setValue,
    formState: { errors, isValid },
  } = useForm<ManualOrderFormValues>({
    resolver: zodResolver(manualOrderFormSchema),
    defaultValues: emptyManualOrderForm,
    mode: "onChange",
  });
  const {
    fields: variantLineFields,
    append: appendVariantLine,
    update: updateVariantLine,
    remove: removeVariantLine,
  } = useFieldArray({ control, name: "lines" });
  const {
    fields: comboLineFields,
    append: appendComboLine,
    remove: removeComboLine,
  } = useFieldArray({ control, name: "combos" });
  const address = useWatch({ control, name: "address" });
  const selectedCustomer = useWatch({ control, name: "selectedCustomer" });
  const lines =
    useWatch({ control, name: "lines" }) ?? emptyManualOrderForm.lines;
  const combos =
    useWatch({ control, name: "combos" }) ?? emptyManualOrderForm.combos;
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [geographyError, setGeographyError] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<ManualOrderCustomer[]>(
    [],
  );
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState(false);
  const [editingLine, setEditingLine] = useState<ManualVariantLine | null>(
    null,
  );
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [agreedRequestKey, setAgreedRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const createCommand = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const customerSearchId = useId();

  useEffect(() => {
    let active = true;
    void fetchBangladeshGeography()
      .then((value) => {
        if (active) setGeography(value);
      })
      .catch(() => {
        if (active) setGeographyError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const search = customerSearch.trim();
    if (search.length < 2 || selectedCustomer) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCustomerLoading(true);
      void searchManualOrderAccounts(search, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setCustomerResults(result.rows);
            setCustomerError(false);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setCustomerResults([]);
            setCustomerError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setCustomerLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [customerSearch, selectedCustomer]);

  const divisionOptions =
    geography?.locations.filter((location) => location.level === "division") ??
    [];
  const districtOptions =
    geography?.locations.filter(
      (location) =>
        location.level === "district" &&
        location.parentId === address.divisionId,
    ) ?? [];
  const upazilaOptions =
    geography?.locations.filter(
      (location) =>
        location.level === "upazila" &&
        location.parentId === address.districtId,
    ) ?? [];

  const inputResult = useMemo(() => {
    if (!geography) return null;
    const checkoutAddress = {
      recipientName: address.recipientName,
      phone: address.phone,
      geographyVersion:
        geography.datasetVersion || BANGLADESH_GEOGRAPHY_VERSION,
      divisionId: address.divisionId,
      districtId: address.districtId,
      ...(address.upazilaId ? { upazilaId: address.upazilaId } : {}),
      doorstepDetails: address.doorstepDetails,
    };
    return ManualOrderInputSchema.safeParse({
      customerId: selectedCustomer?.id ?? null,
      address: checkoutAddress,
      lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
      combos: combos.map(
        ({ lineId, productId, comboRevision, quantity, selections }) => ({
          lineId,
          productId,
          comboRevision,
          quantity,
          selections,
        }),
      ),
    });
  }, [address, combos, geography, lines, selectedCustomer]);
  const validInput = inputResult?.success ? inputResult.data : null;
  const requestKey = validInput ? JSON.stringify(validInput) : "";
  const preview =
    validInput && previewState?.requestKey === requestKey
      ? previewState.value
      : null;
  const agreed = Boolean(preview && agreedRequestKey === requestKey);

  function chooseCustomer(customer: ManualOrderCustomer) {
    setValue("selectedCustomer", customer, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCustomerSearch("");
    setCustomerResults([]);
    setCustomerLoading(false);
    setCustomerError(false);
    setValue("address.recipientName", customer.name, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setPreviewState(null);
    setErrorMessage(null);
  }

  function clearCustomer() {
    setValue("selectedCustomer", null, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setPreviewState(null);
    setAgreedRequestKey("");
  }

  function addVariant(line: ManualVariantLine) {
    const current = getValues("lines");
    const existingIndex = current.findIndex(
      (item) => item.variantId === line.variantId,
    );
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      if (existing) {
        updateVariantLine(existingIndex, {
          ...line,
          quantity: Math.min(
            MAX_CART_QUANTITY_PER_VARIANT,
            existing.quantity + line.quantity,
          ),
        });
      }
    } else {
      appendVariantLine(line);
    }
    setPreviewState(null);
    setAgreedRequestKey("");
    setErrorMessage(null);
  }

  function updateVariant(previousVariantId: string, line: ManualVariantLine) {
    const current = getValues("lines");
    const previousIndex = current.findIndex(
      (item) => item.variantId === previousVariantId,
    );
    if (previousIndex < 0) return;
    const existingIndex = current.findIndex(
      (item) =>
        item.variantId === line.variantId &&
        item.variantId !== previousVariantId,
    );
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      if (!existing) return;
      updateVariantLine(existingIndex, {
        ...line,
        quantity: Math.min(
          MAX_CART_QUANTITY_PER_VARIANT,
          existing.quantity + line.quantity,
        ),
      });
      removeVariantLine(previousIndex);
    } else {
      updateVariantLine(previousIndex, line);
    }
    setEditingLine(null);
    setPreviewState(null);
    setAgreedRequestKey("");
    setErrorMessage(null);
  }

  function addCombo(
    line: ManualOrderInput["combos"][number],
    productName: string,
    unitPriceBdt: number,
  ) {
    appendComboLine({ ...line, productName, unitPriceBdt });
    setPreviewState(null);
    setAgreedRequestKey("");
    setErrorMessage(null);
  }

  function removeVariant(variantId: string) {
    const index = getValues("lines").findIndex(
      (line) => line.variantId === variantId,
    );
    if (index >= 0) removeVariantLine(index);
    if (editingLine?.variantId === variantId) setEditingLine(null);
    setPreviewState(null);
    setAgreedRequestKey("");
  }

  function editVariant(line: ManualVariantLine) {
    setEditingLine(line);
    setPreviewState(null);
    setAgreedRequestKey("");
  }

  function removeCombo(lineId: string) {
    const index = getValues("combos").findIndex(
      (line) => line.lineId === lineId,
    );
    if (index >= 0) removeComboLine(index);
    setPreviewState(null);
    setAgreedRequestKey("");
  }

  async function requestPreview() {
    if (
      !validInput ||
      (validInput.lines.length === 0 && validInput.combos.length === 0)
    ) {
      setErrorMessage(
        "Add at least one catalog item before previewing the Order.",
      );
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setAgreedRequestKey("");
    try {
      const value = await previewManualOrder(validInput);
      setPreviewState({ requestKey, value });
    } catch (error) {
      setPreviewState(null);
      setErrorMessage(
        error instanceof OrderRequestError
          ? error.message
          : "The current prices and delivery fee could not be loaded. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder() {
    if (!validInput || !preview || !agreed) return;
    const fingerprint = `${requestKey}:${preview.fingerprint}`;
    if (createCommand.current?.fingerprint !== fingerprint) {
      createCommand.current = {
        fingerprint,
        key: window.crypto.randomUUID(),
      };
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const order = await createManualOrder(
        {
          ...validInput,
          acceptedTotalBdt: preview.totalBdt,
          previewFingerprint: preview.fingerprint,
          customerAgreed: true,
        },
        createCommand.current.key,
      );
      router.push(`/admin/orders/${order.id}`);
    } catch (error) {
      if (
        error instanceof OrderRequestError &&
        error.errorCode === "MANUAL_ORDER_PREVIEW_CHANGED"
      ) {
        setPreviewState(null);
        setAgreedRequestKey("");
        createCommand.current = null;
      }
      setErrorMessage(
        error instanceof OrderRequestError
          ? error.message
          : "The Order could not be created. Retry after checking the current details.",
      );
      setBusy(false);
    }
  }

  const variantQuantities = Object.fromEntries(
    lines.map(({ variantId, quantity }) => [variantId, quantity]),
  );
  const lineLimitReached = lines.length + combos.length >= MAX_CART_LINES;
  const hasItems = lines.length > 0 || combos.length > 0;

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={handleSubmit(() => requestPreview())}
    >
      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Customer</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Link an existing account or create this as a staff-managed guest
            Order.
          </p>
        </div>
        {selectedCustomer ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="font-medium">{selectedCustomer.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {selectedCustomer.email}
              </p>
            </div>
            <Button
              aria-label="Remove linked customer account"
              onClick={clearCustomer}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={customerSearchId}>
              Search existing customer accounts (optional)
            </label>
            <Input
              autoComplete="off"
              id={customerSearchId}
              onChange={(event) => {
                const value = event.target.value;
                setCustomerSearch(value);
                setCustomerResults([]);
                setCustomerError(false);
                setCustomerLoading(value.trim().length >= 2);
              }}
              placeholder="Name or email"
              type="search"
              value={customerSearch}
            />
            {customerLoading && (
              <p className="text-sm text-muted-foreground" role="status">
                Searching customers…
              </p>
            )}
            {customerError && (
              <p className="text-sm text-destructive" role="alert">
                Customer search failed. You can continue with a guest Order.
              </p>
            )}
            {customerResults.length > 0 && (
              <div className="grid divide-y rounded-lg border border-border">
                {customerResults.map((customer) => (
                  <button
                    className="flex min-h-12 items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-muted"
                    key={customer.id}
                    onClick={() => chooseCustomer(customer)}
                    type="button"
                  >
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-muted-foreground">
                      {customer.email}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {customerSearch.trim().length >= 2 &&
              !customerLoading &&
              !customerError &&
              customerResults.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No existing account found. Continue as a guest Order.
                </p>
              )}
          </div>
        )}
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Delivery details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the recipient and the Bangladesh delivery destination.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Recipient name
            <Input
              aria-invalid={Boolean(errors.address?.recipientName)}
              aria-describedby={
                errors.address?.recipientName
                  ? "manual-order-recipient-error"
                  : undefined
              }
              autoComplete="name"
              id="manual-order-recipient-name"
              maxLength={120}
              {...register("address.recipientName", {
                onChange: () => setErrorMessage(null),
              })}
            />
            {errors.address?.recipientName?.message && (
              <p
                className="text-sm text-destructive"
                id="manual-order-recipient-error"
                role="alert"
              >
                {errors.address.recipientName.message}
              </p>
            )}
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Bangladesh mobile number
            <Input
              aria-invalid={Boolean(errors.address?.phone)}
              aria-describedby={
                errors.address?.phone ? "manual-order-phone-error" : undefined
              }
              autoComplete="tel"
              id="manual-order-phone"
              maxLength={32}
              placeholder="01XXXXXXXXX"
              type="tel"
              {...register("address.phone", {
                onChange: () => setErrorMessage(null),
              })}
            />
            {errors.address?.phone?.message && (
              <p
                className="text-sm text-destructive"
                id="manual-order-phone-error"
                role="alert"
              >
                {errors.address.phone.message}
              </p>
            )}
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Division
            <select
              aria-invalid={Boolean(errors.address?.divisionId)}
              aria-describedby={
                errors.address?.divisionId
                  ? "manual-order-division-error"
                  : undefined
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={!geography}
              id="manual-order-division"
              {...register("address.divisionId", {
                onChange: () => {
                  setValue("address.districtId", "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setValue("address.upazilaId", "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setErrorMessage(null);
                },
              })}
            >
              <option value="">Choose division</option>
              {divisionOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {errors.address?.divisionId?.message && (
              <p
                className="text-sm text-destructive"
                id="manual-order-division-error"
                role="alert"
              >
                {errors.address.divisionId.message}
              </p>
            )}
          </label>
          <label className="grid gap-2 text-sm font-medium">
            District
            <select
              aria-invalid={Boolean(errors.address?.districtId)}
              aria-describedby={
                errors.address?.districtId
                  ? "manual-order-district-error"
                  : undefined
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={!address.divisionId}
              id="manual-order-district"
              {...register("address.districtId", {
                onChange: () => {
                  setValue("address.upazilaId", "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setErrorMessage(null);
                },
              })}
            >
              <option value="">Choose district</option>
              {districtOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {errors.address?.districtId?.message && (
              <p
                className="text-sm text-destructive"
                id="manual-order-district-error"
                role="alert"
              >
                {errors.address.districtId.message}
              </p>
            )}
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Upazila (optional)
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={!address.districtId || upazilaOptions.length === 0}
              id="manual-order-upazila"
              {...register("address.upazilaId", {
                onChange: () => setErrorMessage(null),
              })}
            >
              <option value="">Choose upazila</option>
              {upazilaOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">
            Street address and delivery instructions
            <Textarea
              aria-invalid={Boolean(errors.address?.doorstepDetails)}
              aria-describedby={
                errors.address?.doorstepDetails
                  ? "manual-order-address-error"
                  : undefined
              }
              autoComplete="street-address"
              id="manual-order-doorstep-details"
              maxLength={400}
              placeholder="House, road, area, landmark"
              {...register("address.doorstepDetails", {
                onChange: () => setErrorMessage(null),
              })}
            />
            {errors.address?.doorstepDetails?.message && (
              <p
                className="text-sm text-destructive"
                id="manual-order-address-error"
                role="alert"
              >
                {errors.address.doorstepDetails.message}
              </p>
            )}
          </label>
        </div>
        {geographyError && (
          <p className="text-sm text-destructive" role="alert">
            Delivery areas could not be loaded. Refresh this page and try again.
          </p>
        )}
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Order items</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prices and delivery are confirmed by the server in the next step.
          </p>
        </div>
        <ManualOrderCatalogPicker
          editingLine={editingLine}
          existingVariantQuantities={variantQuantities}
          lineLimitReached={lineLimitReached}
          onAddCombo={addCombo}
          onAddVariant={addVariant}
          onCancelEdit={() => setEditingLine(null)}
          onUpdateVariant={updateVariant}
        />
        {(lines.length > 0 || combos.length > 0) && (
          <div className="divide-y rounded-lg border border-border">
            {lines.map((line, index) => (
              <div
                className="flex items-center justify-between gap-4 p-3"
                key={variantLineFields[index]?.id ?? line.variantId}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.productName}</p>
                  <p className="text-sm text-muted-foreground">
                    {line.color} · {line.sizeLabel} · Qty {line.quantity}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium">
                    {formatBdtPrice({
                      amountBdt: line.unitPriceBdt * line.quantity,
                    })}
                  </span>
                  <Button
                    aria-label={`Edit ${line.productName} ${line.color} ${line.sizeLabel}`}
                    onClick={() => editVariant(line)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <Button
                    aria-label={`Remove ${line.productName}`}
                    onClick={() => removeVariant(line.variantId)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            {combos.map((line, index) => (
              <div
                className="flex items-center justify-between gap-4 p-3"
                key={comboLineFields[index]?.id ?? line.lineId}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.productName}</p>
                  <p className="text-sm text-muted-foreground">
                    Combo · Qty {line.quantity}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium">
                    {formatBdtPrice({
                      amountBdt: line.unitPriceBdt * line.quantity,
                    })}
                  </span>
                  <Button
                    aria-label={`Remove ${line.productName} combo`}
                    onClick={() => removeCombo(line.lineId)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Confirm price and create</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stock is reserved only when the confirmed COD Order is created.
            </p>
          </div>
          <Button
            disabled={
              busy || !validInput || !hasItems || geographyError || !isValid
            }
            type="submit"
            variant="outline"
          >
            {busy ? "Please wait…" : "Preview current total"}
          </Button>
        </div>

        {preview && (
          <div className="grid gap-3 rounded-lg border border-border p-4">
            <h3 className="font-semibold">Current COD total</h3>
            <div className="divide-y">
              {preview.lines
                .filter((line) => line.comboGroupId === null)
                .map((line, index) => (
                  <div
                    className="flex items-start justify-between gap-3 py-2 text-sm"
                    key={`${line.variantId}:${index}`}
                  >
                    <span>
                      {line.productName} · {line.color} · {line.sizeLabel} ×{" "}
                      {line.quantity}
                    </span>
                    <span className="shrink-0">
                      {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                    </span>
                  </div>
                ))}
              {preview.comboGroups.map((group) => (
                <div
                  className="flex items-start justify-between gap-3 py-2 text-sm"
                  key={group.groupId}
                >
                  <span>
                    {group.comboName} · Combo × {group.quantity}
                  </span>
                  <span className="shrink-0">
                    {formatBdtPrice({ amountBdt: group.grossAmountBdt })}
                  </span>
                </div>
              ))}
            </div>
            <dl className="grid gap-2 border-t border-border pt-3 text-sm">
              <PriceRow
                label="Merchandise"
                amountBdt={preview.merchandiseGrossBdt}
              />
              <PriceRow
                label="Delivery"
                amountBdt={preview.deliveryAmountBdt}
              />
              <PriceRow
                label="COD amount due"
                amountBdt={preview.totalBdt}
                strong
              />
            </dl>
            <label className="flex items-start gap-3 border-t border-border pt-3 text-sm">
              <Checkbox
                checked={agreed}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setAgreedRequestKey(checked === true ? requestKey : "")
                }
              />
              <span>
                The customer agreed to pay{" "}
                {formatBdtPrice({ amountBdt: preview.totalBdt })} by cash on
                delivery.
              </span>
            </label>
            <Button
              disabled={busy || !agreed}
              onClick={() => void submitOrder()}
              type="button"
            >
              {busy ? "Creating Order…" : "Create confirmed COD Order"}
            </Button>
          </div>
        )}

        {!validInput && !geographyError && (
          <p className="text-sm text-muted-foreground">
            Complete recipient and delivery details to preview the total.
          </p>
        )}
        {!hasItems && (
          <p className="text-sm text-muted-foreground">
            Add at least one catalog item before previewing the total.
          </p>
        )}
        {errorMessage && (
          <p
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </section>
    </form>
  );
}

function PriceRow({
  label,
  amountBdt,
  strong = false,
}: {
  label: string;
  amountBdt: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${strong ? "text-base font-semibold" : "text-muted-foreground"}`}
    >
      <dt>{label}</dt>
      <dd>{formatBdtPrice({ amountBdt })}</dd>
    </div>
  );
}

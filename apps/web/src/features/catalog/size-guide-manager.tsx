"use client";

import {
  CatalogMeasurementKeySchema,
  CatalogSizeGuidePageSchema,
  CatalogSizeGuideSchema,
  type CatalogMeasurementKey,
  type CatalogSizeGuide,
  type CatalogSizeGuideListQuery,
  type CatalogSizeGuidePage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createCatalogSizeGuide,
  fetchManagedSizeGuide,
  fetchManagedSizeGuides,
  updateCatalogSizeGuide,
} from "@/features/catalog/catalog-client";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import { CatalogCategorySelect } from "@/features/catalog/catalog-category-select";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FieldLabel } from "@/components/ui/field";

type MeasurementValues = Partial<Record<CatalogMeasurementKey, string>>;
interface GuideRowDraft {
  sizeLabel: string;
  values: MeasurementValues;
}
interface GuideForm {
  id: string | null;
  name: string;
  categoryId: string;
  fit: string;
  measurementBasis: "garment" | "body";
  inputUnit: "cm" | "in";
  keys: CatalogMeasurementKey[];
  rows: GuideRowDraft[];
  reason: string;
}

const keys = CatalogMeasurementKeySchema.options;
const labels: Record<CatalogMeasurementKey, string> = {
  chest_width: "Chest width",
  body_length: "Body length",
  shoulder_width: "Shoulder width",
  sleeve_length: "Sleeve length",
  waist: "Waist",
  hip: "Hip",
  inseam: "Inseam",
  outseam: "Outseam",
  rise: "Rise",
  thigh: "Thigh",
  hem: "Hem",
};
const inputClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";
const blankForm: GuideForm = {
  id: null,
  name: "",
  categoryId: "",
  fit: "",
  measurementBasis: "garment",
  inputUnit: "cm",
  keys: ["chest_width", "body_length"],
  rows: [],
  reason: "",
};

export function SizeGuideManager({
  initialPage,
  query,
}: {
  initialPage: CatalogSizeGuidePage;
  query: Pick<CatalogSizeGuideListQuery, "limit" | "offset">;
}) {
  const [guides, setGuides] = useState(initialPage.guides);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { isSubmitting },
  } = useForm<GuideForm>({ defaultValues: blankForm });
  const {
    fields: rowFields,
    append: appendRow,
    remove: removeRow,
  } = useFieldArray({ control, name: "rows" });
  const [editingId, selectedKeys, inputUnit] = useWatch({
    control,
    name: ["id", "keys", "inputUnit"],
  });
  const [isLoadingGuide, setIsLoadingGuide] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadGuides = useCallback(async () => {
    const response = await fetchManagedSizeGuides(query);
    if (!response.ok) throw new Error("Could not refresh size guides.");
    const page = CatalogSizeGuidePageSchema.safeParse(await response.json());
    if (!page.success)
      throw new Error("The server returned an invalid guide list.");
    setGuides(page.data.guides);
    setHasMore(page.data.hasMore);
    setNextOffset(page.data.nextOffset);
  }, [query]);

  function clearKeyValues(key: CatalogMeasurementKey) {
    getValues("rows").forEach((_, index) => {
      setValue(`rows.${index}.values.${key}`, "", { shouldDirty: true });
    });
  }

  function changeInputUnit(
    inputUnit: GuideForm["inputUnit"],
    onChange: (value: GuideForm["inputUnit"]) => void,
  ) {
    const current = getValues();
    if (current.inputUnit === inputUnit) return;
    current.rows.forEach((row, index) => {
      current.keys.forEach((key) => {
        setValue(
          `rows.${index}.values.${key}`,
          convertMeasurementUnit(
            row.values[key] ?? "",
            current.inputUnit,
            inputUnit,
          ),
          { shouldDirty: true },
        );
      });
    });
    onChange(inputUnit);
  }

  async function editGuide(guideId: string) {
    setIsLoadingGuide(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetchManagedSizeGuide(guideId);
      if (!response.ok) {
        throw new Error(await readSizeGuideErrorMessage(response));
      }
      const result = CatalogSizeGuideSchema.safeParse(await response.json());
      if (!result.success)
        throw new Error("The server returned an invalid guide.");
      reset(toSizeGuideFormState(result.data));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Size guide details are temporarily unavailable.",
      );
    } finally {
      setIsLoadingGuide(false);
    }
  }

  function resetForm() {
    reset(blankForm);
    setErrorMessage(null);
    setStatusMessage(null);
  }

  async function saveGuide(form: GuideForm) {
    setErrorMessage(null);
    setStatusMessage(null);
    if (form.keys.length === 0 || form.rows.length === 0) {
      setErrorMessage("Choose at least one measurement and add a size row.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      fit: form.fit.trim() || null,
      measurementBasis: form.measurementBasis,
      inputUnit: form.inputUnit,
      rows: form.rows.map((row) => ({
        sizeLabel: row.sizeLabel.trim(),
        measurements: form.keys.map((key) => ({
          key,
          value: row.values[key]?.trim() ?? "",
        })),
      })),
      reason: form.reason.trim(),
    };

    try {
      const response = form.id
        ? await updateCatalogSizeGuide(form.id, payload)
        : await createCatalogSizeGuide(payload);
      if (!response.ok) {
        setErrorMessage(await readSizeGuideErrorMessage(response));
        return;
      }
      const result = CatalogSizeGuideSchema.safeParse(await response.json());
      if (!result.success) {
        setErrorMessage("The server returned an invalid size guide.");
        return;
      }
      setStatusMessage(form.id ? "Size guide updated." : "Size guide created.");
      reset(blankForm);
      await loadGuides();
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ STAFF
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Size guides
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Create a reusable chart for products with the same category, fit,
              measurement basis, and sizes.
            </p>
          </div>
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href="/staff/catalog"
          >
            Back to products
          </Link>
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href="/staff/catalog/categories"
          >
            Manage categories
          </Link>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.95fr)]">
          <section aria-labelledby="size-guide-list-heading">
            <h2 className="text-xl font-semibold" id="size-guide-list-heading">
              Reusable guides
            </h2>
            {guides.length === 0 ? (
              <p className="mt-4 rounded-xl border border-border bg-card/60 p-5 text-muted-foreground">
                No size guides yet. Add a chart using the form.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {guides.map((guide) => (
                  <li
                    className="rounded-xl border border-border bg-card/60 p-4"
                    key={guide.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{guide.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {guide.category.name}
                          {guide.fit ? ` · ${guide.fit} fit` : ""} ·{" "}
                          {guide.measurementBasis} measurements
                        </p>
                        <p className="mt-2 text-sm">
                          Sizes: {guide.sizeLabels.join(", ")}
                        </p>
                        <Badge className="mt-2" variant="secondary">
                          Reusable
                        </Badge>
                      </div>
                      <Button
                        className="h-auto shrink-0 px-3 py-2"
                        type="button"
                        variant="outline"
                        disabled={isLoadingGuide}
                        onClick={() => void editGuide(guide.id)}
                      >
                        Edit
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <CatalogPagination
              itemName="size guides"
              label="Size guides"
              pathname="/staff/catalog/size-guides"
              limit={query.limit}
              offset={query.offset}
              productCount={guides.length}
              hasMore={hasMore}
              nextOffset={nextOffset}
            />
          </section>

          <Card
            aria-labelledby="guide-form-heading"
            className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7"
            role="region"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" id="guide-form-heading">
                  {editingId ? "Edit size guide" : "Create a size guide"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Measurements are stored once in millimetres and shown in cm
                  and inches.
                </p>
              </div>
              {editingId && (
                <Button
                  className="h-auto px-2 py-1 text-sm text-muted-foreground"
                  type="button"
                  variant="ghost"
                  onClick={resetForm}
                >
                  New guide
                </Button>
              )}
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit(saveGuide)}>
              <Field>
                <FieldLabel htmlFor="guide-name">Guide name</FieldLabel>
                <Input
                  className={inputClassName}
                  id="guide-name"
                  maxLength={120}
                  required
                  {...register("name", { required: true, maxLength: 120 })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="categoryId"
                  render={({ field }) => (
                    <CatalogCategorySelect
                      id="guide-category"
                      label="Product category"
                      required
                      value={field.value}
                      name={field.name}
                      inputRef={field.ref}
                      onBlur={field.onBlur}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Field>
                  <FieldLabel htmlFor="guide-fit">
                    Fit{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FieldLabel>
                  <Input
                    className={inputClassName}
                    id="guide-fit"
                    maxLength={80}
                    {...register("fit")}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="measurement-basis">
                    Measurement basis
                  </FieldLabel>
                  <NativeSelect
                    className={inputClassName}
                    id="measurement-basis"
                    {...register("measurementBasis")}
                  >
                    <option value="garment">Garment measurements</option>
                    <option value="body">Body measurements</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="measurement-unit">
                    Enter measurements in
                  </FieldLabel>
                  <Controller
                    control={control}
                    name="inputUnit"
                    render={({ field }) => (
                      <NativeSelect
                        className={inputClassName}
                        id="measurement-unit"
                        name={field.name}
                        ref={field.ref}
                        value={field.value}
                        onBlur={field.onBlur}
                        onChange={(event) =>
                          changeInputUnit(
                            event.target.value as GuideForm["inputUnit"],
                            field.onChange,
                          )
                        }
                      >
                        <option value="cm">Centimetres (cm)</option>
                        <option value="in">Inches (in)</option>
                      </NativeSelect>
                    )}
                  />
                </Field>
              </div>

              <fieldset className="space-y-2 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium">
                  Measurements included
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {keys.map((key) => (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={key}
                    >
                      <input
                        type="checkbox"
                        value={key}
                        {...register("keys", {
                          onChange: () => clearKeyValues(key),
                        })}
                      />
                      {labels[key]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <section
                aria-labelledby="guide-sizes-heading"
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold" id="guide-sizes-heading">
                    Size rows
                  </h3>
                  <Button
                    className="h-auto px-3 py-2"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      appendRow({
                        sizeLabel: "",
                        values: Object.fromEntries(
                          selectedKeys.map((key) => [key, ""]),
                        ),
                      })
                    }
                  >
                    Add size
                  </Button>
                </div>
                {rowFields.map((row, index) => (
                  <fieldset
                    className="space-y-3 rounded-xl border border-border bg-background/70 p-4"
                    key={row.id}
                  >
                    <legend className="sr-only">Size row {index + 1}</legend>
                    <label
                      className="block space-y-1 text-sm font-medium"
                      htmlFor={`size-label-${index}`}
                    >
                      Size label
                      <Input
                        className={inputClassName}
                        id={`size-label-${index}`}
                        maxLength={40}
                        required
                        {...register(`rows.${index}.sizeLabel` as const, {
                          required: true,
                        })}
                        placeholder="Example: M or One Size"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedKeys.map((key) => (
                        <label
                          className="block space-y-1 text-sm"
                          htmlFor={`size-${index}-${key}`}
                          key={key}
                        >
                          {labels[key]} ({inputUnit})
                          <Input
                            className={inputClassName}
                            id={`size-${index}-${key}`}
                            inputMode="decimal"
                            max="9999.999"
                            min="0.001"
                            required
                            step="0.001"
                            type="number"
                            {...register(
                              `rows.${index}.values.${key}` as const,
                              { required: true },
                            )}
                          />
                        </label>
                      ))}
                    </div>
                    <Button
                      className="h-auto px-2 py-1 text-sm text-destructive"
                      type="button"
                      variant="ghost"
                      onClick={() => removeRow(index)}
                    >
                      Remove size
                    </Button>
                  </fieldset>
                ))}
                {rowFields.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Add each size sold for this guide. “One Size” is a valid
                    label.
                  </p>
                )}
              </section>

              <Field>
                <FieldLabel htmlFor="guide-audit-reason">
                  Audit reason
                </FieldLabel>
                <Input
                  className={inputClassName}
                  id="guide-audit-reason"
                  maxLength={500}
                  minLength={3}
                  required
                  {...register("reason", { required: true, minLength: 3 })}
                />
              </Field>
              {errorMessage && (
                <p
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {errorMessage}
                </p>
              )}
              {statusMessage && (
                <p
                  className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
                  role="status"
                >
                  {statusMessage}
                </p>
              )}
              <Button
                className="h-auto w-full px-4 py-3 text-base font-semibold"
                disabled={isSubmitting || isLoadingGuide}
                type="submit"
              >
                {isSubmitting
                  ? "Saving…"
                  : editingId
                    ? "Save guide"
                    : "Create guide"}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </main>
  );
}

function toSizeGuideFormState(guide: CatalogSizeGuide): GuideForm {
  return {
    id: guide.id,
    name: guide.name,
    categoryId: guide.category.id,
    fit: guide.fit ?? "",
    measurementBasis: guide.measurementBasis,
    inputUnit: "cm",
    keys: guide.rows[0]?.measurements.map(({ key }) => key) ?? [],
    rows: guide.rows.map((row) => ({
      sizeLabel: row.sizeLabel,
      values: Object.fromEntries(
        row.measurements.map(({ key, valueMm }) => [
          key,
          millimetersToCm(valueMm),
        ]),
      ),
    })),
    reason: "",
  };
}

function millimetersToCm(valueMm: string): string {
  const [whole, fraction = "00"] = valueMm.split(".");
  const thousandthsOfCm = Number(whole ?? "0") * 100 + Number(fraction);
  return `${Math.floor(thousandthsOfCm / 1000)}.${String(thousandthsOfCm % 1000).padStart(3, "0")}`;
}

function convertMeasurementUnit(
  value: string,
  from: GuideForm["inputUnit"],
  to: GuideForm["inputUnit"],
): string {
  if (!value || from === to) return value;
  const [whole, fraction = ""] = value.split(".");
  const thousandths = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  const millimeterHundredths =
    from === "cm" ? thousandths : Math.floor((thousandths * 254 + 50) / 100);
  const converted =
    to === "cm"
      ? millimeterHundredths
      : Math.floor((millimeterHundredths * 100 + 127) / 254);
  return `${Math.floor(converted / 1000)}.${String(converted % 1000).padStart(3, "0")}`;
}

async function readSizeGuideErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("message" in body)) {
      return "Could not save this size guide.";
    }
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) {
      return body.message
        .filter((item): item is string => typeof item === "string")
        .join(" ");
    }
    return "Could not save this size guide.";
  } catch {
    return "Could not reach the server. Please try again.";
  }
}

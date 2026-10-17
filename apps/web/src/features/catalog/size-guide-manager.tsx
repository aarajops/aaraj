"use client";

import {
  CatalogMeasurementKeySchema,
  CatalogSizeGuideSchema,
  type CatalogMeasurementKey,
  type CatalogCategoryOption,
  type CatalogSizeGuide,
  type CatalogSizeGuideListQuery,
  type CatalogSizeGuidePage,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createCatalogSizeGuide,
  updateCatalogSizeGuide,
} from "@/features/catalog/catalog-client";
import { CatalogCategorySelect } from "@/features/catalog/catalog-category-select";
import {
  blankGuideForm,
  convertMeasurementUnit,
  guideFormSchema,
  toSizeGuideFormState,
  type GuideForm,
  type GuideSubmission,
} from "@/features/catalog/size-guide-form";
import { SizeGuideTable } from "@/features/catalog/size-guide-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { hasDirtyFieldsExcept } from "@/lib/form-dirty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
export function SizeGuideManager({
  view = "list",
  initialPage,
  initialGuide,
  query,
  categoryOptions = [],
}: {
  view?: "list" | "create" | "edit";
  initialPage?: CatalogSizeGuidePage;
  initialGuide?: CatalogSizeGuide;
  query: CatalogSizeGuideListQuery;
  categoryOptions?: CatalogCategoryOption[];
}) {
  const router = useRouter();
  const guides = initialPage?.guides ?? [];
  const hasMore = initialPage?.hasMore ?? false;
  const nextOffset = initialPage?.nextOffset ?? null;
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<GuideForm, unknown, GuideSubmission>({
    resolver: zodResolver(guideFormSchema),
    defaultValues: initialGuide
      ? toSizeGuideFormState(initialGuide)
      : blankGuideForm,
  });
  const {
    fields: rowFields,
    append: appendRow,
    remove: removeRow,
  } = useFieldArray({ control, name: "rows" });
  const [selectedKeys, inputUnit] = useWatch({
    control,
    name: ["keys", "inputUnit"],
  });
  const hasGuideChanges = hasDirtyFieldsExcept(dirtyFields, ["id", "reason"]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  async function saveGuide(submission: GuideSubmission) {
    if (submission.id && !hasGuideChanges) return;
    setErrorMessage(null);

    try {
      const response = submission.id
        ? await updateCatalogSizeGuide(submission.id, submission.input)
        : await createCatalogSizeGuide(submission.input);
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        setErrorMessage(
          getApiErrorMessage(problem) ??
            "The API returned an unreadable error response.",
        );
        return;
      }
      const result = CatalogSizeGuideSchema.safeParse(await response.json());
      if (!result.success) {
        setErrorMessage("The server returned an invalid size guide.");
        return;
      }
      router.replace("/admin/catalog/size-guides");
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
              {view === "create"
                ? "Create size guide"
                : view === "edit"
                  ? "Edit size guide"
                  : "Size guides"}
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Create a reusable chart for products with the same category, fit,
              measurement basis, and sizes.
            </p>
          </div>
          {view === "list" ? (
            <Link
              className={buttonVariants({ size: "lg" })}
              href="/admin/catalog/size-guides/create"
            >
              Create size guide
            </Link>
          ) : (
            <Link
              className="text-sm text-primary hover:text-primary/80"
              href="/admin/catalog/size-guides"
            >
              Back to size guides
            </Link>
          )}
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href="/admin/catalog"
          >
            Back to products
          </Link>
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href="/admin/catalog/categories"
          >
            Manage categories
          </Link>
        </div>

        <div className="mt-10">
          {view === "list" && (
            <section aria-labelledby="size-guide-list-heading">
              <h2
                className="text-xl font-semibold"
                id="size-guide-list-heading"
              >
                Reusable guides
              </h2>
              <div className="mt-4">
                <SizeGuideTable
                  guides={guides}
                  categoryOptions={categoryOptions}
                  query={query}
                  onRefresh={() => router.refresh()}
                  hasMore={hasMore}
                  nextOffset={nextOffset}
                />
              </div>
            </section>
          )}

          {view !== "list" && (
            <Card
              aria-labelledby="guide-form-heading"
              className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7"
              role="region"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold" id="guide-form-heading">
                    {view === "edit"
                      ? "Edit size guide"
                      : "Create a size guide"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Measurements are stored in centimeters. You can enter them
                    in cm or inches.
                  </p>
                </div>
                <Link
                  className="text-sm text-primary hover:text-primary/80"
                  href="/admin/catalog/size-guides"
                >
                  Cancel
                </Link>
              </div>

              <form
                className="mt-6 space-y-4"
                noValidate
                onSubmit={handleSubmit(saveGuide)}
              >
                <Field>
                  <FieldLabel htmlFor="guide-name">Guide name</FieldLabel>
                  <Input
                    aria-describedby={
                      errors.name ? "guide-name-error" : undefined
                    }
                    aria-invalid={Boolean(errors.name)}
                    className={inputClassName}
                    id="guide-name"
                    maxLength={120}
                    required
                    {...register("name")}
                  />
                  {errors.name && (
                    <FieldError id="guide-name-error">
                      {errors.name.message}
                    </FieldError>
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Controller
                    control={control}
                    name="categoryId"
                    render={({ field, fieldState }) => (
                      <CatalogCategorySelect
                        id="guide-category"
                        label="Product category"
                        required
                        errorMessage={fieldState.error?.message}
                        value={field.value}
                        name={field.name}
                        triggerRef={field.ref}
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
                      aria-describedby={
                        errors.fit ? "guide-fit-error" : undefined
                      }
                      aria-invalid={Boolean(errors.fit)}
                      className={inputClassName}
                      id="guide-fit"
                      maxLength={80}
                      {...register("fit")}
                    />
                    {errors.fit && (
                      <FieldError id="guide-fit-error">
                        {errors.fit.message}
                      </FieldError>
                    )}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel
                      id="measurement-basis-label"
                      htmlFor="measurement-basis"
                    >
                      Measurement basis
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="measurementBasis"
                      render={({ field }) => (
                        <Select
                          items={[
                            { label: "Garment measurements", value: "garment" },
                            { label: "Body measurements", value: "body" },
                          ]}
                          name={field.name}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger
                            id="measurement-basis"
                            aria-labelledby="measurement-basis-label"
                            ref={field.ref}
                            onBlur={field.onBlur}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="garment">
                              Garment measurements
                            </SelectItem>
                            <SelectItem value="body">
                              Body measurements
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field>
                    <FieldLabel
                      id="measurement-unit-label"
                      htmlFor="measurement-unit"
                    >
                      Enter measurements in
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="inputUnit"
                      render={({ field }) => (
                        <Select
                          items={[
                            { label: "Centimetres (cm)", value: "cm" },
                            { label: "Inches (in)", value: "in" },
                          ]}
                          name={field.name}
                          value={field.value}
                          onValueChange={(value) =>
                            changeInputUnit(
                              String(value) as GuideForm["inputUnit"],
                              field.onChange,
                            )
                          }
                        >
                          <SelectTrigger
                            id="measurement-unit"
                            aria-labelledby="measurement-unit-label"
                            ref={field.ref}
                            onBlur={field.onBlur}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cm">Centimetres (cm)</SelectItem>
                            <SelectItem value="in">Inches (in)</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>

                <fieldset
                  aria-describedby={
                    errors.keys ? "guide-keys-error" : undefined
                  }
                  className="space-y-2 rounded-xl border border-border p-4"
                >
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
                          aria-describedby={
                            errors.keys ? "guide-keys-error" : undefined
                          }
                          aria-invalid={Boolean(errors.keys)}
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
                  {errors.keys && (
                    <FieldError id="guide-keys-error">
                      {errors.keys.message}
                    </FieldError>
                  )}
                </fieldset>

                <section
                  aria-labelledby="guide-sizes-heading"
                  aria-describedby={
                    errors.rows?.root ? "guide-rows-error" : undefined
                  }
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
                      <div className="space-y-1 text-sm font-medium">
                        <label htmlFor={`size-label-${index}`}>
                          Size label
                        </label>
                        <Input
                          aria-describedby={
                            errors.rows?.[index]?.sizeLabel
                              ? `size-label-${index}-error`
                              : undefined
                          }
                          aria-invalid={Boolean(
                            errors.rows?.[index]?.sizeLabel,
                          )}
                          className={inputClassName}
                          id={`size-label-${index}`}
                          maxLength={40}
                          required
                          {...register(`rows.${index}.sizeLabel` as const)}
                          placeholder="Example: M or One Size"
                        />
                        {errors.rows?.[index]?.sizeLabel && (
                          <FieldError id={`size-label-${index}-error`}>
                            {errors.rows[index].sizeLabel.message}
                          </FieldError>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {selectedKeys.map((key) => (
                          <div className="space-y-1 text-sm" key={key}>
                            <label htmlFor={`size-${index}-${key}`}>
                              {labels[key]} ({inputUnit})
                            </label>
                            <Input
                              aria-describedby={
                                errors.rows?.[index]?.values?.[key]
                                  ? `size-${index}-${key}-error`
                                  : undefined
                              }
                              aria-invalid={Boolean(
                                errors.rows?.[index]?.values?.[key],
                              )}
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
                              )}
                            />
                            {errors.rows?.[index]?.values?.[key] && (
                              <FieldError id={`size-${index}-${key}-error`}>
                                {errors.rows[index].values[key].message}
                              </FieldError>
                            )}
                          </div>
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
                  {errors.rows?.root?.message && (
                    <FieldError id="guide-rows-error">
                      {errors.rows.root.message}
                    </FieldError>
                  )}
                </section>

                <Field>
                  <FieldLabel htmlFor="guide-audit-reason">
                    Audit reason
                  </FieldLabel>
                  <Input
                    aria-describedby={
                      errors.reason ? "guide-reason-error" : undefined
                    }
                    aria-invalid={Boolean(errors.reason)}
                    className={inputClassName}
                    id="guide-audit-reason"
                    maxLength={500}
                    minLength={3}
                    required
                    {...register("reason")}
                  />
                  {errors.reason && (
                    <FieldError id="guide-reason-error">
                      {errors.reason.message}
                    </FieldError>
                  )}
                </Field>
                {errorMessage && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                )}
                <Button
                  className="h-auto w-full px-4 py-3 text-base font-semibold"
                  disabled={
                    isSubmitting || (view === "edit" && !hasGuideChanges)
                  }
                  type="submit"
                >
                  {isSubmitting
                    ? "Saving…"
                    : view === "edit"
                      ? "Save guide"
                      : "Create guide"}
                </Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

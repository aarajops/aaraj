"use client";

import {
  CatalogMeasurementKeySchema,
  CatalogSizeGuideSchema,
  type CatalogMeasurementKey,
  type CatalogCategory,
  type CatalogSizeGuide,
  type CatalogSizeGuideListQuery,
  type CatalogSizeGuidePage,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  SortableProvider,
  useSortableItem,
} from "@/components/dnd/sortable-list";
import { Input } from "@/components/ui/input";
import {
  createCatalogSizeGuide,
  updateCatalogSizeGuide,
} from "@/features/catalog/catalog-client";
import { CatalogCategorySelect } from "@/features/catalog/catalog-category-select";
import { catalogMeasurementLabels } from "@/features/catalog/size-guide-labels";
import {
  blankGuideForm,
  formatMeasurementInput,
  guideFormSchema,
  toSizeGuideFormState,
  type GuideForm,
  type GuideSubmission,
} from "@/features/catalog/size-guide-form";
import { SizeGuideTable } from "@/features/catalog/size-guide-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { GripVertical } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function SortableSizeGuideRow({
  id,
  index,
  disabled,
  children,
}: {
  id: string;
  index: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const { ref, handleRef } = useSortableItem(id, index, disabled);

  return (
    <TableRow ref={ref}>
      <TableCell className="w-10 px-2 align-top">
        <Button
          aria-label={`Reorder size row ${index + 1}`}
          className="text-muted-foreground"
          disabled={disabled}
          ref={handleRef}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <GripVertical aria-hidden="true" />
        </Button>
      </TableCell>
      {children}
    </TableRow>
  );
}

const keys = CatalogMeasurementKeySchema.options;
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
  categoryOptions?: CatalogCategory[];
}) {
  const router = useRouter();
  const guides = initialPage?.guides ?? [];
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
    move: moveRow,
  } = useFieldArray({ control, name: "rows" });
  const selectedKeys = useWatch({
    control,
    name: "keys",
  });
  const hasGuideChanges = hasDirtyFieldsExcept(dirtyFields, ["id"]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function clearKeyValues(key: CatalogMeasurementKey) {
    getValues("rows").forEach((_, index) => {
      setValue(`rows.${index}.values.${key}`, "", { shouldDirty: true });
    });
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
      <div className="container mx-auto">
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
              Guides match products by category, fit, measurement basis, and
              size.
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
                  page={initialPage ?? null}
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
                    Choose the unit used by your source size chart.
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
                <div className="max-w-sm">
                  <Controller
                    control={control}
                    name="categoryId"
                    render={({ field, fieldState }) => (
                      <CatalogCategorySelect
                        id="guide-category"
                        label="Guide category"
                        categories={categoryOptions}
                        allowParentCategories
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
                        {catalogMeasurementLabels[key]}
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
                    <div>
                      <h3 className="font-semibold" id="guide-sizes-heading">
                        Size rows
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Drag rows to set the size order shown to shoppers.
                      </p>
                    </div>
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
                  {rowFields.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Add each size sold for this guide. “One Size” is a valid
                      label.
                    </p>
                  )}
                  {rowFields.length > 0 && (
                    <div className="rounded-md border">
                      <SortableProvider onMove={moveRow}>
                        <Table
                          className="min-w-max"
                          scrollRegionLabel="Scrollable size guide measurements"
                        >
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10 px-2" scope="col">
                                <span className="sr-only">Reorder</span>
                              </TableHead>
                              <TableHead scope="col">Size label</TableHead>
                              {selectedKeys.map((key) => (
                                <TableHead key={key} scope="col">
                                  {catalogMeasurementLabels[key]} (in)
                                </TableHead>
                              ))}
                              <TableHead className="text-right" scope="col">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rowFields.map((row, index) => (
                              <SortableSizeGuideRow
                                disabled={isSubmitting}
                                id={row.id}
                                index={index}
                                key={row.id}
                              >
                                <TableCell className="min-w-40 align-top">
                                  <label
                                    className="sr-only"
                                    htmlFor={`size-label-${index}`}
                                  >
                                    Size label, row {index + 1}
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
                                    id={`size-label-${index}`}
                                    maxLength={40}
                                    placeholder="e.g. M"
                                    required
                                    {...register(
                                      `rows.${index}.sizeLabel` as const,
                                    )}
                                  />
                                  {errors.rows?.[index]?.sizeLabel && (
                                    <FieldError
                                      id={`size-label-${index}-error`}
                                    >
                                      {errors.rows[index].sizeLabel.message}
                                    </FieldError>
                                  )}
                                </TableCell>
                                {selectedKeys.map((key) => {
                                  const fieldName =
                                    `rows.${index}.values.${key}` as const;
                                  const fieldRegistration = register(fieldName);
                                  const fieldId = `size-${index}-${key}`;
                                  const fieldError =
                                    errors.rows?.[index]?.values?.[key];

                                  return (
                                    <TableCell
                                      className="min-w-40 align-top"
                                      key={key}
                                    >
                                      <label
                                        className="sr-only"
                                        htmlFor={fieldId}
                                      >
                                        {`${catalogMeasurementLabels[key]} (in), size row ${index + 1}`}
                                      </label>
                                      <Input
                                        aria-describedby={
                                          fieldError
                                            ? `${fieldId}-error`
                                            : undefined
                                        }
                                        aria-invalid={Boolean(fieldError)}
                                        id={fieldId}
                                        inputMode="decimal"
                                        max="9999.9"
                                        min="0.1"
                                        required
                                        step="0.1"
                                        type="number"
                                        {...fieldRegistration}
                                        onBlur={(event) => {
                                          const value =
                                            event.currentTarget.value;
                                          void fieldRegistration.onBlur(event);
                                          const formattedValue =
                                            formatMeasurementInput(value);
                                          if (formattedValue !== value) {
                                            setValue(
                                              fieldName,
                                              formattedValue,
                                              {
                                                shouldDirty: true,
                                                shouldValidate: true,
                                              },
                                            );
                                          }
                                        }}
                                      />
                                      {fieldError && (
                                        <FieldError id={`${fieldId}-error`}>
                                          {fieldError.message}
                                        </FieldError>
                                      )}
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="align-top text-right">
                                  <Button
                                    aria-label={`Remove size row ${index + 1}`}
                                    className="text-destructive"
                                    type="button"
                                    variant="ghost"
                                    onClick={() => removeRow(index)}
                                  >
                                    Remove
                                  </Button>
                                </TableCell>
                              </SortableSizeGuideRow>
                            ))}
                          </TableBody>
                        </Table>
                      </SortableProvider>
                    </div>
                  )}
                  {errors.rows?.root?.message && (
                    <FieldError id="guide-rows-error">
                      {errors.rows.root.message}
                    </FieldError>
                  )}
                </section>

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

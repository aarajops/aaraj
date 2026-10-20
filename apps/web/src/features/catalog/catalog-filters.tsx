"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Form from "next/form";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  CatalogAudienceSchema,
  DEFAULT_PUBLIC_CATALOG_PAGE_SIZE,
  CatalogPublishedProductSortSchema,
  type CatalogProductFilterOptions,
  type CatalogPublishedProductListQuery,
} from "@aaraj/contracts";
import { formatCatalogPrice } from "./price";

interface CatalogFiltersProps {
  options: Pick<
    CatalogProductFilterOptions,
    "colors" | "sizes" | "priceRange"
  > | null;
  query: CatalogPublishedProductListQuery;
  pathname: string;
  categoryInPath?: boolean;
  allowSort?: boolean;
  children: ReactNode;
}

type FilterSelection = {
  audience: string | undefined;
  colors: readonly string[];
  sizes: readonly string[];
  minPriceBdt: number | undefined;
  maxPriceBdt: number | undefined;
};

function hasAvailableCatalogFilters(
  options: CatalogFiltersProps["options"],
): boolean {
  return Boolean(
    options &&
    (options.colors.length > 0 ||
      options.sizes.length > 0 ||
      options.priceRange),
  );
}

export function CatalogFilters({
  options,
  query,
  pathname,
  categoryInPath = false,
  children,
}: CatalogFiltersProps) {
  const currentQuery = useCurrentCatalogQuery(query);
  const showFilters = hasAvailableCatalogFilters(options);

  return (
    <div className="grid gap-6 lg:grid-cols-4 xl:gap-8">
      {showFilters && (
        <aside
          aria-label="Product filters"
          className="hidden min-w-0 lg:col-span-1 lg:block"
        >
          <h2 className="mb-3 mt-5 flex items-center gap-2 text-base font-semibold text-foreground">
            <SlidersHorizontal
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            Filters
          </h2>
          <FilterForm
            categoryInPath={categoryInPath}
            options={options}
            pathname={pathname}
            query={currentQuery}
          />
        </aside>
      )}
      <section
        aria-label="Product results"
        className={`min-w-0 ${showFilters ? "lg:col-span-3" : "lg:col-span-4"}`}
      >
        {children}
      </section>
    </div>
  );
}

export function CatalogResultsToolbar({
  options,
  query,
  pathname,
  categoryInPath = false,
  allowSort = true,
}: Omit<CatalogFiltersProps, "children">) {
  const currentQuery = useCurrentCatalogQuery(query);
  const activeFilters = getActiveFilters(currentQuery);
  const showFilters =
    hasAvailableCatalogFilters(options) || activeFilters.length > 0;

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      {showFilters && (
        <div className="flex justify-end lg:hidden">
          <MobileCatalogFilters
            activeFilterCount={activeFilters.length}
            categoryInPath={categoryInPath}
            options={options}
            pathname={pathname}
            query={currentQuery}
          />
        </div>
      )}
      {activeFilters.length > 0 && (
        <AppliedFilters
          activeFilters={activeFilters}
          categoryInPath={categoryInPath}
          pathname={pathname}
          query={currentQuery}
        />
      )}
      {allowSort && (
        <SortControl
          categoryInPath={categoryInPath}
          pathname={pathname}
          query={currentQuery}
        />
      )}
    </div>
  );
}

function useCurrentCatalogQuery(
  query: CatalogPublishedProductListQuery,
): CatalogPublishedProductListQuery {
  const searchParams = useSearchParams();
  return {
    ...query,
    search: searchParams.get("search") ?? undefined,
  };
}

function syncSearchParam(form: HTMLFormElement) {
  const currentSearch = new URLSearchParams(window.location.search).get(
    "search",
  );
  const input = form.querySelector<HTMLInputElement>('input[name="search"]');

  if (!currentSearch) {
    input?.remove();
    return;
  }

  const searchInput = input ?? document.createElement("input");
  searchInput.type = "hidden";
  searchInput.name = "search";
  searchInput.value = currentSearch;
  if (!input) form.append(searchInput);
}

function MobileCatalogFilters({
  activeFilterCount,
  categoryInPath,
  options,
  pathname,
  query,
}: Omit<CatalogFiltersProps, "children"> & { activeFilterCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button type="button" variant="outline">
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                {activeFilterCount}
                <span className="sr-only"> active filters</span>
              </span>
            )}
          </Button>
        }
      />
      <SheetContent className="gap-0 p-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Choose options to refine products.
          </SheetDescription>
        </SheetHeader>
        <FilterForm
          categoryInPath={categoryInPath}
          mobile
          onNavigate={() => setOpen(false)}
          options={options}
          pathname={pathname}
          query={query}
        />
      </SheetContent>
    </Sheet>
  );
}

function FilterForm({
  categoryInPath = false,
  mobile = false,
  onNavigate,
  options,
  pathname,
  query,
}: Omit<CatalogFiltersProps, "children"> & {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const selection: FilterSelection = {
    audience: query.audience,
    colors: query.color ?? [],
    sizes: query.size ?? [],
    minPriceBdt: query.minPriceBdt,
    maxPriceBdt: query.maxPriceBdt,
  };
  const selectionKey = JSON.stringify(selection);
  const clearHref = getCatalogHref(pathname, query, categoryInPath, {
    audience: undefined,
    colors: [],
    sizes: [],
    minPriceBdt: undefined,
    maxPriceBdt: undefined,
  });
  useEffect(
    () => () => {
      if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    },
    [],
  );

  function schedulePriceSubmit(form: HTMLFormElement | null) {
    if (!form) return;
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      submitTimer.current = null;
      syncSearchParam(form);
      form.requestSubmit();
    }, 300);
  }

  function submitPriceSelection() {
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      submitTimer.current = null;
      const form = formRef.current;
      if (!form) return;
      syncSearchParam(form);
      form.requestSubmit();
    }, 0);
  }

  const clearLink =
    mobile && getActiveFilters(query).length > 0 ? (
      <Link
        className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        href={clearHref}
        onClick={onNavigate}
      >
        Clear filters
      </Link>
    ) : null;

  return (
    <Form
      action={pathname}
      aria-label="Filter products"
      className={
        mobile
          ? "flex min-h-0 flex-1 flex-col"
          : "min-w-0 rounded-xl border border-border bg-card p-5"
      }
      ref={formRef}
      scroll={false}
      onChange={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement &&
          (target.type === "checkbox" || target.type === "radio")
        ) {
          if (submitTimer.current !== null) {
            clearTimeout(submitTimer.current);
            submitTimer.current = null;
          }
          syncSearchParam(event.currentTarget);
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <PreservedCatalogFields
        categoryInPath={categoryInPath}
        omit="filters"
        query={query}
      />
      <div className={mobile ? "min-h-0 flex-1 overflow-y-auto p-4" : ""}>
        <div key={selectionKey} className="space-y-5">
          <PriceRangeFilter
            maxPriceBdt={selection.maxPriceBdt}
            minPriceBdt={selection.minPriceBdt}
            onPriceCommit={submitPriceSelection}
            onPriceChange={schedulePriceSubmit}
            priceRange={options?.priceRange ?? null}
          />
          <FilterGroups options={options} selection={selection} />
        </div>
      </div>
      {mobile
        ? clearLink && (
            <SheetFooter className="border-t border-border">
              {clearLink}
            </SheetFooter>
          )
        : null}
    </Form>
  );
}

function PriceRangeFilter({
  minPriceBdt,
  maxPriceBdt,
  priceRange,
  onPriceCommit,
  onPriceChange,
}: Pick<FilterSelection, "minPriceBdt" | "maxPriceBdt"> & {
  priceRange: CatalogProductFilterOptions["priceRange"];
  onPriceCommit: () => void;
  onPriceChange: (form: HTMLFormElement | null) => void;
}) {
  const id = useId();
  const [minimum, setMinimum] = useState(
    minPriceBdt === undefined ? "" : String(minPriceBdt),
  );
  const [maximum, setMaximum] = useState(
    maxPriceBdt === undefined ? "" : String(maxPriceBdt),
  );
  const sliderMin = 0;
  const sliderMax = priceRange?.maxPriceBdt ?? 0;
  const selectedMinimum = minimum === "" ? sliderMin : Number(minimum);
  const selectedMaximum = maximum === "" ? sliderMax : Number(maximum);
  const sliderValues = priceRange
    ? [
        Math.max(sliderMin, Math.min(sliderMax, selectedMinimum)),
        Math.max(sliderMin, Math.min(sliderMax, selectedMaximum)),
      ]
    : null;

  if (!priceRange) return null;

  function updatePriceRange(value: number | readonly number[]) {
    if (!Array.isArray(value) || value.length < 2 || !priceRange) return;
    const [nextMinimum, nextMaximum] = value;
    setMinimum(nextMinimum <= sliderMin ? "" : String(nextMinimum));
    setMaximum(
      nextMaximum >= priceRange.maxPriceBdt ? "" : String(nextMaximum),
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-foreground">
        Price range
      </legend>
      {priceRange && sliderMax > sliderMin && sliderValues && (
        <Slider
          max={sliderMax}
          min={sliderMin}
          onValueChange={updatePriceRange}
          onValueCommitted={(value) => {
            updatePriceRange(value);
            onPriceCommit();
          }}
          step={1}
          thumbAlignment="edge"
          value={sliderValues}
        >
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb aria-label="Minimum price" index={0} />
              <SliderThumb aria-label="Maximum price" index={1} />
            </SliderTrack>
          </SliderControl>
        </Slider>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-min`}>Minimum (৳)</FieldLabel>
          <Input
            id={`${id}-min`}
            inputMode="numeric"
            max={selectedMaximum}
            min={sliderMin}
            name={minimum === "" ? undefined : "minPriceBdt"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setMinimum(
                value === "" || Number(value) <= sliderMin ? "" : value,
              );
              onPriceChange(event.currentTarget.form);
            }}
            step={1}
            type="number"
            value={minimum === "" ? sliderMin : minimum}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-max`}>Maximum (৳)</FieldLabel>
          <Input
            id={`${id}-max`}
            inputMode="numeric"
            max={sliderMax}
            min={selectedMinimum}
            name={maximum === "" ? undefined : "maxPriceBdt"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setMaximum(
                value === "" || Number(value) >= sliderMax ? "" : value,
              );
              onPriceChange(event.currentTarget.form);
            }}
            step={1}
            type="number"
            value={maximum === "" ? sliderMax : maximum}
          />
        </Field>
      </div>
    </fieldset>
  );
}

function SortControl({
  categoryInPath,
  pathname,
  query,
}: {
  categoryInPath: boolean;
  pathname: string;
  query: CatalogPublishedProductListQuery;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortOptions = CatalogPublishedProductSortSchema.options.map((sort) => ({
    label: getSortLabel(sort),
    value: sort,
  }));
  useEffect(
    () => () => {
      if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    },
    [],
  );

  function submitSortChange() {
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      submitTimer.current = null;
      const form = formRef.current;
      if (!form) return;
      syncSearchParam(form);
      form.requestSubmit();
    }, 0);
  }

  return (
    <Form
      action={pathname}
      aria-label="Sort products"
      className="ml-auto"
      ref={formRef}
      scroll={false}
    >
      <PreservedCatalogFields
        categoryInPath={categoryInPath}
        omit="sort"
        query={query}
      />
      <Field className="w-36 sm:w-44">
        <FieldLabel htmlFor={id}>Sort by</FieldLabel>
        <Select
          defaultValue={query.sort ?? "newest"}
          items={sortOptions}
          key={query.sort ?? "newest"}
          name="sort"
          onValueChange={submitSortChange}
        >
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CatalogPublishedProductSortSchema.options.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {getSortLabel(sort)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Form>
  );
}

function getSortLabel(
  sort: (typeof CatalogPublishedProductSortSchema.options)[number],
) {
  switch (sort) {
    case "newest":
      return "Newest";
    case "price-ascending":
      return "Price: low to high";
    case "price-descending":
      return "Price: high to low";
  }
}

function PreservedCatalogFields({
  categoryInPath,
  omit,
  query,
}: {
  categoryInPath: boolean;
  omit: "filters" | "sort";
  query: CatalogPublishedProductListQuery;
}) {
  return (
    <>
      {query.limit !== DEFAULT_PUBLIC_CATALOG_PAGE_SIZE && (
        <input name="limit" type="hidden" value={query.limit} />
      )}
      {query.search && (
        <input name="search" type="hidden" value={query.search} />
      )}
      {query.category && !categoryInPath && (
        <input name="category" type="hidden" value={query.category} />
      )}
      {omit !== "filters" && query.audience && (
        <input name="audience" type="hidden" value={query.audience} />
      )}
      {omit !== "filters" &&
        (query.color ?? []).map((color) => (
          <input
            key={`color:${color}`}
            name="color"
            type="hidden"
            value={color}
          />
        ))}
      {omit !== "filters" &&
        (query.size ?? []).map((size) => (
          <input key={`size:${size}`} name="size" type="hidden" value={size} />
        ))}
      {omit !== "filters" && query.minPriceBdt !== undefined && (
        <input name="minPriceBdt" type="hidden" value={query.minPriceBdt} />
      )}
      {omit !== "filters" && query.maxPriceBdt !== undefined && (
        <input name="maxPriceBdt" type="hidden" value={query.maxPriceBdt} />
      )}
      {omit !== "sort" && query.sort && (
        <input name="sort" type="hidden" value={query.sort} />
      )}
    </>
  );
}

function FilterGroups({
  options,
  selection,
}: {
  options: CatalogFiltersProps["options"];
  selection: FilterSelection;
}) {
  const audienceId = useId();
  const sizes = options?.sizes ?? [];
  const colors = options?.colors ?? [];

  return (
    <div className="space-y-6">
      <CheckboxFilterGroup
        label="Size"
        name="size"
        options={sizes}
        selectedValues={selection.sizes}
      />
      <CheckboxFilterGroup
        label="Color"
        name="color"
        options={colors}
        selectedValues={selection.colors}
      />

      <fieldset className="space-y-3">
        <legend
          className="text-sm font-semibold text-foreground"
          id={`${audienceId}-label`}
        >
          Audience
        </legend>
        <RadioGroup
          aria-labelledby={`${audienceId}-label`}
          className="grid-cols-2 gap-2"
          defaultValue={selection.audience ?? ""}
          name="audience"
        >
          <AudienceOption
            id={`${audienceId}-all`}
            label="All audiences"
            value=""
          />
          {CatalogAudienceSchema.options.map((audience) => (
            <AudienceOption
              id={`${audienceId}-${audience}`}
              key={audience}
              label={capitalize(audience)}
              value={audience}
            />
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  );
}

function CheckboxFilterGroup({
  label,
  name,
  options,
  selectedValues,
}: {
  label: string;
  name: "color" | "size";
  options: string[];
  selectedValues: readonly string[];
}) {
  const id = useId();
  if (options.length === 0) return null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-foreground">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((value, index) => {
          const inputId = `${id}-${index}`;
          return (
            <FieldLabel
              className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-2.5 font-normal transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
              htmlFor={inputId}
              key={value}
            >
              <Checkbox
                defaultChecked={hasFilterValue(selectedValues, value)}
                id={inputId}
                name={name}
                value={value}
              />
              <span className="min-w-0 break-words">{value}</span>
            </FieldLabel>
          );
        })}
      </div>
    </fieldset>
  );
}

function AudienceOption({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  return (
    <FieldLabel
      className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-2.5 font-normal transition-colors hover:bg-muted/50 has-[[data-checked]]:border-primary/50 has-[[data-checked]]:bg-primary/5"
      htmlFor={id}
    >
      <RadioGroupItem id={id} value={value} />
      <span>{label}</span>
    </FieldLabel>
  );
}

function AppliedFilters({
  activeFilters,
  categoryInPath = false,
  pathname,
  query,
}: Omit<CatalogFiltersProps, "children" | "options"> & {
  activeFilters: ActiveFilter[];
}) {
  return (
    <div
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2"
      role="group"
    >
      {activeFilters.map((filter) => (
        <Link
          aria-label={`Remove ${filter.label} filter`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={getCatalogHref(
            pathname,
            query,
            categoryInPath,
            filter.selection,
          )}
          key={filter.key}
        >
          {filter.label}
          <X aria-hidden="true" className="size-3.5" />
        </Link>
      ))}
      <Link
        className="px-2 py-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={getCatalogHref(pathname, query, categoryInPath, {
          audience: undefined,
          colors: [],
          sizes: [],
          minPriceBdt: undefined,
          maxPriceBdt: undefined,
        })}
      >
        Clear filters
      </Link>
    </div>
  );
}

type ActiveFilter = {
  key: string;
  label: string;
  selection: FilterSelection;
};

function getActiveFilters(
  query: CatalogPublishedProductListQuery,
): ActiveFilter[] {
  const colors = query.color ?? [];
  const sizes = query.size ?? [];
  const filters: ActiveFilter[] = [];

  if (query.audience) {
    filters.push({
      key: "audience",
      label: `Audience: ${capitalize(query.audience)}`,
      selection: {
        audience: undefined,
        colors,
        sizes,
        minPriceBdt: query.minPriceBdt,
        maxPriceBdt: query.maxPriceBdt,
      },
    });
  }
  for (const color of colors) {
    filters.push({
      key: `color:${color}`,
      label: `Color: ${color}`,
      selection: {
        audience: query.audience,
        colors: colors.filter((value) => value !== color),
        sizes,
        minPriceBdt: query.minPriceBdt,
        maxPriceBdt: query.maxPriceBdt,
      },
    });
  }
  for (const size of sizes) {
    filters.push({
      key: `size:${size}`,
      label: `Size: ${size}`,
      selection: {
        audience: query.audience,
        colors,
        sizes: sizes.filter((value) => value !== size),
        minPriceBdt: query.minPriceBdt,
        maxPriceBdt: query.maxPriceBdt,
      },
    });
  }
  if (query.minPriceBdt !== undefined || query.maxPriceBdt !== undefined) {
    const minimum = query.minPriceBdt;
    const maximum = query.maxPriceBdt;
    const range =
      minimum !== undefined
        ? maximum !== undefined
          ? `${formatCatalogPrice({ amountBdt: minimum })}–${formatCatalogPrice({ amountBdt: maximum })}`
          : `From ${formatCatalogPrice({ amountBdt: minimum })}`
        : maximum !== undefined
          ? `Up to ${formatCatalogPrice({ amountBdt: maximum })}`
          : "";
    filters.push({
      key: "price",
      label: `Price: ${range}`,
      selection: {
        audience: query.audience,
        colors,
        sizes,
        minPriceBdt: undefined,
        maxPriceBdt: undefined,
      },
    });
  }
  return filters;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toLocaleUpperCase("en-US") + value.slice(1);
}

function hasFilterValue(values: readonly string[], value: string): boolean {
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  return values.some(
    (candidate) =>
      candidate.trim().toLocaleLowerCase("en-US") === normalizedValue,
  );
}

function getCatalogHref(
  pathname: string,
  query: CatalogPublishedProductListQuery,
  categoryInPath: boolean,
  selection: FilterSelection,
): string {
  const params = new URLSearchParams();
  if (query.limit !== DEFAULT_PUBLIC_CATALOG_PAGE_SIZE) {
    params.set("limit", String(query.limit));
  }
  if (query.search) params.set("search", query.search);
  if (query.category && !categoryInPath) {
    params.set("category", query.category);
  }
  if (query.sort) params.set("sort", query.sort);
  if (selection.audience) params.set("audience", selection.audience);
  for (const color of selection.colors) params.append("color", color);
  for (const size of selection.sizes) params.append("size", size);
  if (selection.minPriceBdt !== undefined) {
    params.set("minPriceBdt", String(selection.minPriceBdt));
  }
  if (selection.maxPriceBdt !== undefined) {
    params.set("maxPriceBdt", String(selection.maxPriceBdt));
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

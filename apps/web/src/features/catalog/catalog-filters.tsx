import Link from "next/link";
import type {
  CatalogProductFilterOptions,
  CatalogPublishedProductListQuery,
} from "@aaraj/contracts";

interface CatalogFiltersProps {
  options: CatalogProductFilterOptions | null;
  query: CatalogPublishedProductListQuery;
}

export function CatalogFilters({ options, query }: CatalogFiltersProps) {
  const hasActiveFilters = Boolean(
    query.audience || query.category || query.color || query.size,
  );

  return (
    <form
      action="/"
      aria-label="Filter products"
      className="mt-8 grid gap-4 rounded-2xl border border-border bg-card/50 p-5 sm:grid-cols-2 lg:grid-cols-4"
      method="get"
    >
      <input name="limit" type="hidden" value={query.limit} />
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Audience
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={query.audience ?? ""}
          name="audience"
        >
          <option value="">All audiences</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Category
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={selectedCategoryValue(
            options?.categories ?? [],
            query.category,
          )}
          name="category"
        >
          <option value="">All categories</option>
          {(options?.categories ?? []).map((category) => (
            <option key={category.id} value={category.slug}>
              {category.path}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Color
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={selectedFilterValue(options?.colors ?? [], query.color)}
          name="color"
        >
          <option value="">All colors</option>
          {(options?.colors ?? []).map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Size
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={selectedFilterValue(options?.sizes ?? [], query.size)}
          name="size"
        >
          <option value="">All sizes</option>
          {(options?.sizes ?? []).map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button
          className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          type="submit"
        >
          Apply filters
        </button>
        {hasActiveFilters && (
          <Link
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

function selectedFilterValue(
  values: string[],
  selectedValue: string | undefined,
): string {
  if (!selectedValue) return "";
  const normalized = selectedValue.trim().toLocaleLowerCase("en-US");
  return (
    values.find(
      (value) => value.trim().toLocaleLowerCase("en-US") === normalized,
    ) ?? ""
  );
}

function selectedCategoryValue(
  values: CatalogProductFilterOptions["categories"],
  selectedValue: string | undefined,
): string {
  return selectedValue && values.some(({ slug }) => slug === selectedValue)
    ? selectedValue
    : "";
}

import type { CatalogPrice } from "@aaraj/contracts";
import { formatBdtPrice } from "@/lib/currency";

export function ProductPrice({
  price,
  compareAtPrice,
  startingAt = false,
  size = "compact",
}: {
  price: CatalogPrice;
  compareAtPrice?: CatalogPrice | null;
  startingAt?: boolean;
  size?: "compact" | "prominent";
}) {
  const showCompareAtPrice =
    compareAtPrice !== null &&
    compareAtPrice !== undefined &&
    compareAtPrice.amountBdt > price.amountBdt;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span
        className={
          size === "prominent"
            ? "text-xl font-semibold tracking-tight text-primary"
            : "text-xs font-medium text-primary"
        }
      >
        {startingAt ? "From " : ""}
        {formatBdtPrice(price)}
      </span>
      {showCompareAtPrice && (
        <span
          className={
            size === "prominent"
              ? "inline-flex items-baseline gap-1 text-sm text-muted-foreground"
              : "inline-flex items-baseline gap-1 text-xs text-muted-foreground"
          }
        >
          <del>{formatBdtPrice(compareAtPrice)}</del>
        </span>
      )}
    </span>
  );
}

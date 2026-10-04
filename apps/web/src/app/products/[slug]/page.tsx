import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedProduct } from "@/features/catalog/catalog-queries";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getPublishedProduct(slug);

  if ("kind" in result && result.kind === "not-found") notFound();
  if ("kind" in result) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-14 text-foreground sm:py-20">
        <div className="mx-auto max-w-3xl">
          <p
            className="rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Product details are temporarily unavailable. Please try again
            shortly.
          </p>
          <Link
            className="mt-6 inline-block text-primary hover:text-primary/80"
            href="/"
          >
            ← Back to products
          </Link>
        </div>
      </main>
    );
  }

  const { product } = result;
  const variantsByColor = new Map<string, { color: string; sizes: string[] }>();
  for (const variant of product.variants) {
    const colorKey = variant.color.trim().toLowerCase();
    const group = variantsByColor.get(colorKey) ?? {
      color: variant.color,
      sizes: [],
    };
    const guideLabel = product.sizeGuide?.rows.find(
      (row) =>
        row.sizeLabel.trim().toLowerCase() ===
        variant.sizeLabel.trim().toLowerCase(),
    )?.sizeLabel;
    group.sizes.push(guideLabel ?? variant.sizeLabel);
    variantsByColor.set(colorKey, group);
  }
  const sizeOrder = new Map(
    product.sizeGuide?.rows.map((row, index) => [
      row.sizeLabel.trim().toLowerCase(),
      index,
    ]) ?? [],
  );
  for (const group of variantsByColor.values()) {
    group.sizes.sort((left, right) => {
      const leftOrder = sizeOrder.get(left.trim().toLowerCase());
      const rightOrder = sizeOrder.get(right.trim().toLowerCase());
      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left.localeCompare(right);
    });
  }
  const measurementLabels: Record<string, string> = {
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
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-14 text-foreground sm:py-20">
      <article className="mx-auto max-w-3xl">
        <Link className="text-sm text-primary hover:text-primary/80" href="/">
          ← All products
        </Link>
        <div className="mt-8 rounded-2xl border border-border bg-card/70 p-7 sm:p-10">
          <p className="text-sm font-semibold tracking-[0.16em] text-primary">
            AARAJ PRODUCT
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.name}
          </h1>
          {(product.audience || product.category) && (
            <p className="mt-3 text-sm text-muted-foreground">
              {[product.audience, product.category].filter(Boolean).join(" · ")}
              {product.fit ? ` · ${product.fit} fit` : ""}
            </p>
          )}
          {product.description ? (
            <p className="mt-6 whitespace-pre-wrap text-base leading-7 text-secondary-foreground">
              {product.description}
            </p>
          ) : (
            <p className="mt-6 text-muted-foreground">
              More product details coming soon.
            </p>
          )}
          {product.fabricComposition && (
            <p className="mt-5 text-sm text-secondary-foreground">
              <strong>Fabric:</strong> {product.fabricComposition}
            </p>
          )}
          {product.careInstructions && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-secondary-foreground">
              <strong>Care:</strong> {product.careInstructions}
            </p>
          )}
          {variantsByColor.size > 0 && (
            <section
              aria-labelledby="available-variants-heading"
              className="mt-8 border-t border-border pt-6"
            >
              <h2
                className="text-lg font-semibold"
                id="available-variants-heading"
              >
                Available colors and sizes
              </h2>
              <ul className="mt-3 space-y-3">
                {[...variantsByColor.values()].map(({ color, sizes }) => (
                  <li className="flex flex-wrap gap-2 text-sm" key={color}>
                    <span className="mr-2 font-medium">{color}</span>
                    {sizes.map((size) => (
                      <span
                        className="rounded-full border border-border px-2.5 py-1 text-muted-foreground"
                        key={`${color}:${size}`}
                      >
                        {size}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {product.sizeGuide && (
            <section
              aria-labelledby="size-guide-heading"
              className="mt-8 border-t border-border pt-6"
            >
              <h2 className="text-lg font-semibold" id="size-guide-heading">
                Size guide: {product.sizeGuide.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {product.sizeGuide.measurementBasis === "garment"
                  ? "Garment"
                  : "Body"}{" "}
                measurements · values shown in cm / in
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-semibold">Size</th>
                      {(product.sizeGuide.rows[0]?.measurements ?? []).map(
                        ({ key }) => (
                          <th className="px-3 py-2 font-semibold" key={key}>
                            {measurementLabels[key] ?? key} (cm / in)
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {product.sizeGuide.rows.map((row) => (
                      <tr className="border-b border-border/70" key={row.id}>
                        <th className="px-3 py-2 font-medium">
                          {row.sizeLabel}
                        </th>
                        {(product.sizeGuide?.rows[0]?.measurements ?? []).map(
                          ({ key }) => {
                            const measurement = row.measurements.find(
                              (item) => item.key === key,
                            );
                            return (
                              <td
                                className="px-3 py-2 text-muted-foreground"
                                key={key}
                              >
                                {measurement
                                  ? `${formatMeasurement(measurement.valueMm, "cm")} / ${formatMeasurement(measurement.valueMm, "in")}`
                                  : "—"}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </article>
    </main>
  );
}

function formatMeasurement(valueMm: string, unit: "cm" | "in"): string {
  const [whole, fraction = "00"] = valueMm.split(".");
  const hundredthsOfMillimeter = Number(whole ?? "0") * 100 + Number(fraction);
  const tenths =
    unit === "cm"
      ? Math.floor((hundredthsOfMillimeter + 50) / 100)
      : Math.floor((hundredthsOfMillimeter + 127) / 254);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

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
          {product.description ? (
            <p className="mt-6 whitespace-pre-wrap text-base leading-7 text-secondary-foreground">
              {product.description}
            </p>
          ) : (
            <p className="mt-6 text-muted-foreground">
              More product details coming soon.
            </p>
          )}
        </div>
      </article>
    </main>
  );
}

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
      <main className="min-h-[calc(100vh-4rem)] bg-zinc-950 px-5 py-14 text-zinc-100 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <p
            className="rounded-xl border border-amber-900/70 bg-amber-950/30 p-5 text-amber-100"
            role="alert"
          >
            Product details are temporarily unavailable. Please try again
            shortly.
          </p>
          <Link
            className="mt-6 inline-block text-emerald-300 hover:text-emerald-200"
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
    <main className="min-h-[calc(100vh-4rem)] bg-zinc-950 px-5 py-14 text-zinc-100 sm:py-20">
      <article className="mx-auto max-w-3xl">
        <Link
          className="text-sm text-emerald-300 hover:text-emerald-200"
          href="/"
        >
          ← All products
        </Link>
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-7 sm:p-10">
          <p className="text-sm font-semibold tracking-[0.16em] text-emerald-300">
            AARAJ PRODUCT
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.name}
          </h1>
          {product.description ? (
            <p className="mt-6 whitespace-pre-wrap text-base leading-7 text-zinc-300">
              {product.description}
            </p>
          ) : (
            <p className="mt-6 text-zinc-400">
              More product details coming soon.
            </p>
          )}
        </div>
      </article>
    </main>
  );
}

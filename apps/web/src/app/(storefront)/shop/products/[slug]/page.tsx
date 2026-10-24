import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedProduct } from "@/features/catalog/catalog-queries";
import {
  getStorefrontMetadataDefaults,
  getStorefrontShareImage,
} from "@/features/storefront/storefront-metadata";
import { ProductGallery } from "./product-gallery";
import { ProductPurchase } from "./product-purchase";

type ProductPageSearchParams = {
  color?: string | string[];
  size?: string | string[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [result, defaults] = await Promise.all([
    getPublishedProduct(slug),
    getStorefrontMetadataDefaults(),
  ]);

  if ("kind" in result) {
    return {
      title:
        result.kind === "not-found" ? "Product not found" : "Product details",
      description: defaults.description,
      robots: { index: false, follow: false },
    };
  }

  const description = result.product.description || defaults.description;
  const productImage = result.product.images[0];
  const images = productImage
    ? [
        {
          url: productImage.detail.src,
          width: productImage.detail.width,
          height: productImage.detail.height,
          alt: productImage.altText,
        },
        ...(defaults.settings.socialImage ? [defaults.image] : []),
      ]
    : [getStorefrontShareImage(defaults.settings)];
  const canonical = `/shop/products/${result.product.slug}`;

  return {
    title: result.product.name,
    description,
    alternates: { canonical },
    openGraph: {
      title: result.product.name,
      description,
      siteName: defaults.settings.siteName,
      url: canonical,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: result.product.name,
      description,
      images: images.map(({ url, width, height, alt, ...image }) => ({
        url,
        width,
        height,
        alt,
        ...("type" in image ? { type: image.type } : {}),
      })),
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ProductPageSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await getPublishedProduct(slug);

  if ("kind" in result && result.kind === "not-found") notFound();
  if ("kind" in result) {
    return (
      <main className="container mx-auto flex-1 px-5 py-10 text-foreground sm:py-14">
        <div className="max-w-3xl">
          <p
            className="rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Product details are temporarily unavailable. Please try again
            shortly.
          </p>
          <Link
            className="mt-6 inline-block text-primary hover:text-primary/80"
            href="/shop"
          >
            Back to products
          </Link>
        </div>
      </main>
    );
  }

  const { product } = result;
  const initialColor = singleQueryValue(query.color);
  const initialSize = singleQueryValue(query.size);

  return (
    <main className="container mx-auto flex-1 px-5 py-10 text-foreground sm:py-14">
      <article className="space-y-8 sm:space-y-10">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li>
              <Link className="hover:text-foreground" href="/shop">
                Shop
              </Link>
            </li>
            {product.category && (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link
                    className="hover:text-foreground"
                    href={`/shop/categories/${encodeURIComponent(product.category.slug)}`}
                  >
                    {product.category.name}
                  </Link>
                </li>
              </>
            )}
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              {product.name}
            </li>
          </ol>
        </nav>

        <div
          className={`grid items-start gap-8 lg:gap-10 ${
            product.images.length > 0 ? "lg:grid-cols-2" : ""
          }`}
        >
          <ProductGallery
            images={product.images}
            productName={product.name}
            variants={product.variants}
          />
          <section aria-labelledby="product-title" className="min-w-0">
            <h1
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="product-title"
            >
              {product.name}
            </h1>
            {product.fit && (
              <p className="mt-2 text-sm text-muted-foreground">
                {product.fit} fit
              </p>
            )}
            <ProductPurchase
              initialColor={initialColor}
              initialSize={initialSize}
              productId={product.id}
              productName={product.name}
              sizeGuide={product.sizeGuide}
              variants={product.variants}
            />
          </section>
        </div>

        {(product.description ||
          product.fabricComposition ||
          product.careInstructions) && (
          <section
            aria-labelledby="product-details-heading"
            className="max-w-4xl border-t border-border pt-8"
          >
            <h2
              className="text-lg font-semibold tracking-tight"
              id="product-details-heading"
            >
              Product details
            </h2>
            {product.description && (
              <p className="mt-3 whitespace-pre-wrap leading-7 text-secondary-foreground">
                {product.description}
              </p>
            )}
            {(product.fabricComposition || product.careInstructions) && (
              <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                {product.fabricComposition && (
                  <div className="space-y-1">
                    <dt className="text-sm font-medium">Fabric</dt>
                    <dd className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {product.fabricComposition}
                    </dd>
                  </div>
                )}
                {product.careInstructions && (
                  <div className="space-y-1">
                    <dt className="text-sm font-medium">Care</dt>
                    <dd className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {product.careInstructions}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        )}
      </article>
    </main>
  );
}

function singleQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

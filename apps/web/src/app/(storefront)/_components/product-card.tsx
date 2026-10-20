import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { CatalogPublishedProductListItem } from "@aaraj/contracts";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCatalogPrice } from "@/features/catalog/price";
import { ProductLinkStatus } from "@/features/catalog/product-link-status";

export function ProductCardSkeleton() {
  return (
    <article className="flex h-full flex-col">
      <AspectRatio className="overflow-hidden bg-muted/30" ratio={1}>
        <Skeleton className="size-full rounded-none" />
      </AspectRatio>
      <div className="pt-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-1 h-4 w-1/3" />
      </div>
    </article>
  );
}

export function ProductCard({
  product,
}: {
  product: CatalogPublishedProductListItem;
}) {
  const href = `/shop/products/${product.slug}`;
  const primaryImage = product.images[0];
  const hoverImage = product.images[1];

  return (
    <article className="flex h-full flex-col">
      {primaryImage ? (
        <Link
          aria-label={`View ${product.name}`}
          className="group/image block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={href}
        >
          <AspectRatio className="overflow-hidden bg-muted/30" ratio={1}>
            <Image
              alt={primaryImage.altText}
              className={`h-full w-full object-cover ${hoverImage ? "transition-opacity duration-300 motion-reduce:transition-none group-hover/image:opacity-0 group-focus-visible/image:opacity-0" : ""}`}
              height={primaryImage.card.height}
              src={primaryImage.card.src}
              unoptimized
              width={primaryImage.card.width}
            />
            {hoverImage && (
              <Image
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 motion-reduce:transition-none group-hover/image:opacity-100 group-focus-visible/image:opacity-100"
                height={hoverImage.card.height}
                src={hoverImage.card.src}
                unoptimized
                width={hoverImage.card.width}
              />
            )}
          </AspectRatio>
        </Link>
      ) : (
        <AspectRatio
          aria-label={`${product.name}: image unavailable`}
          className="grid place-items-center bg-muted/30 text-muted-foreground"
          ratio={1}
          role="img"
        >
          <ImageOff aria-hidden="true" className="size-8" />
        </AspectRatio>
      )}
      <div className="pt-4">
        <Link
          className="group/link rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={href}
        >
          <h2 className="line-clamp-2 text-xs font-medium uppercase leading-5 tracking-wide text-foreground group-hover/link:text-primary">
            {product.name}
          </h2>
          {product.price && (
            <p className="mt-1 text-xs text-primary">
              {product.priceVaries && "From "}
              {formatCatalogPrice(product.price)}
            </p>
          )}
          <ProductLinkStatus />
        </Link>
      </div>
    </article>
  );
}

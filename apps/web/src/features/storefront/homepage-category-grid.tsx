"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import type { CatalogPublishedCategoryOption } from "@aaraj/contracts";

function CategoryImage({
  category,
}: {
  category: CatalogPublishedCategoryOption;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground sm:size-[4.5rem]">
      {category.image && !imageFailed ? (
        <Image
          alt=""
          className="h-full w-full object-contain p-2"
          height={category.image.height}
          onError={() => setImageFailed(true)}
          src={category.image.src}
          unoptimized
          width={category.image.width}
        />
      ) : (
        <ImageIcon aria-hidden="true" className="size-7" />
      )}
    </span>
  );
}

function productCountLabel(count: number): string {
  return `${count} ${count === 1 ? "product" : "products"}`;
}

export function HomepageCategoryGrid({
  categories,
}: {
  categories: CatalogPublishedCategoryOption[];
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            className="group flex min-h-40 h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-3 py-4 text-center transition-colors hover:border-primary/35 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-44 sm:px-4"
            href={`/shop/categories/${category.slug}`}
          >
            <CategoryImage category={category} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                {category.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {productCountLabel(category.publishedProductCount)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

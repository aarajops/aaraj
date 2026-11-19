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
    <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground sm:size-24">
      {category.image && !imageFailed ? (
        <Image
          alt=""
          className="h-full w-full object-contain p-2 transition-transform duration-200 motion-reduce:transition-none motion-safe:group-hover:scale-105"
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
    <ul className="flex flex-wrap justify-center gap-3 sm:gap-4">
      {categories.map((category) => (
        <li
          className="w-[calc((100%_-_0.75rem)/2)] max-w-[12.5rem] sm:w-[calc((100%_-_2rem)/3)] lg:w-[calc((100%_-_3rem)/4)] xl:w-[calc((100%_-_5rem)/6)]"
          key={category.id}
        >
          <Link
            className="group flex min-h-56 h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-3 py-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:px-4"
            href={`/shop/categories/${category.slug}`}
          >
            <CategoryImage category={category} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="line-clamp-2 text-base font-semibold leading-5 text-foreground">
                {category.name}
              </span>
              <span className="text-sm text-muted-foreground">
                {productCountLabel(category.publishedProductCount)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { PublicStorefrontBanners } from "@aaraj/contracts";

export function StorefrontBannerImage({
  banner,
  loading = "eager",
  fetchPriority = "high",
}: {
  banner: PublicStorefrontBanners["banners"][number];
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const image = (
    <picture className="block w-full overflow-hidden">
      {banner.mobile && (
        <source
          media="(max-width: 639px)"
          srcSet={banner.mobile.src}
          width={banner.mobile.width}
          height={banner.mobile.height}
        />
      )}
      <Image
        alt={banner.altText}
        className="block h-auto w-full"
        fetchPriority={fetchPriority}
        height={banner.desktop.height}
        loading={loading}
        sizes="100vw"
        src={banner.desktop.src}
        unoptimized
        width={banner.desktop.width}
      />
    </picture>
  );

  return banner.href ? (
    <Link
      aria-label={banner.altText || "View featured promotion"}
      className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      href={banner.href}
    >
      {image}
    </Link>
  ) : (
    image
  );
}

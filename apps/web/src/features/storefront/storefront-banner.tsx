import type { PublicStorefrontBanners } from "@aaraj/contracts";
import { StorefrontBannerCarousel } from "./storefront-banner-carousel";
import { StorefrontBannerImage } from "./storefront-banner-image";

export function StorefrontBanner({
  banners,
}: {
  banners: PublicStorefrontBanners | null;
}) {
  const slides = banners?.banners ?? [];
  if (slides.length === 0) return null;
  if (slides.length > 1) {
    return <StorefrontBannerCarousel slides={slides} />;
  }

  const [banner] = slides;
  if (!banner) return null;

  return (
    <section className="w-full" aria-label="Featured promotion">
      <StorefrontBannerImage banner={banner} />
    </section>
  );
}

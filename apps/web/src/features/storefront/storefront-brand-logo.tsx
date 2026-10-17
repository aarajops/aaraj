import type { PublicStorefrontSettings } from "@aaraj/contracts";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type StorefrontBrandLogoProps = {
  siteName: PublicStorefrontSettings["siteName"];
  logo: PublicStorefrontSettings["logo"];
  imageClassName: string;
  inverseFallback?: boolean;
  loading?: "eager" | "lazy";
};

export function StorefrontBrandLogo({
  siteName,
  logo,
  imageClassName,
  inverseFallback = false,
  loading,
}: StorefrontBrandLogoProps) {
  return (
    <Link
      aria-label={`${siteName} home`}
      className="inline-flex min-h-10 shrink-0 items-center"
      href="/"
    >
      <Image
        alt={`${siteName} logo`}
        className={cn(
          "w-auto object-contain",
          imageClassName,
          !logo && inverseFallback && "brightness-0 invert",
        )}
        height={logo?.height ?? 156}
        loading={loading}
        src={logo?.src ?? "/aaraj-logo.svg"}
        unoptimized
        width={logo?.width ?? 512}
      />
    </Link>
  );
}

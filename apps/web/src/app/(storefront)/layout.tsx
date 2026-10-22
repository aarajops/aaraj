import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { GoogleTagManager } from "@next/third-parties/google";
import { SiteHeader } from "@/app/_components/site-header";
import { StoreFooter } from "@/app/_components/store-footer";
import { CartProvider } from "@/features/cart/cart-provider";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [settings, requestHeaders] = await Promise.all([
    getPublicStorefrontSettings(),
    headers(),
  ]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const storefrontTheme = {
    "--background": settings.backgroundColor,
    "--brand": settings.brandColor,
  } as CSSProperties;

  return (
    <>
      {process.env.NODE_ENV === "production" ? (
        <GoogleTagManager gtmId="GTM-N28C5K72" nonce={nonce} />
      ) : null}
      <CartProvider>
        <div
          className="flex min-h-screen flex-col bg-background text-foreground"
          style={storefrontTheme}
        >
          <SiteHeader />
          {children}
          <StoreFooter />
        </div>
      </CartProvider>
    </>
  );
}

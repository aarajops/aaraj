import type { CSSProperties } from "react";
import { SiteHeader } from "@/app/_components/site-header";
import { StoreFooter } from "@/app/_components/store-footer";
import { CartProvider } from "@/features/cart/cart-provider";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getPublicStorefrontSettings();
  const storefrontTheme = {
    "--background": settings.backgroundColor,
    "--brand": settings.brandColor,
  } as CSSProperties;

  return (
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
  );
}

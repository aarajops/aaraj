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

  return (
    <>
      {process.env.NODE_ENV === "production" ? (
        <GoogleTagManager gtmId="GTM-N28C5K72" nonce={nonce} />
      ) : null}
      <style nonce={nonce}>
        {`.storefront-theme{--background:${settings.backgroundColor};--brand:${settings.brandColor}}`}
      </style>
      <CartProvider>
        <div className="storefront-theme flex min-h-screen flex-col bg-background text-foreground">
          <SiteHeader />
          {children}
          <StoreFooter />
        </div>
      </CartProvider>
    </>
  );
}

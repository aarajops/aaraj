import { headers } from "next/headers";
import { GoogleTagManager } from "@next/third-parties/google";
import { SiteHeader } from "@/app/_components/site-header";
import { StoreFooter } from "@/app/_components/store-footer";
import { CartProvider } from "@/features/cart/cart-provider";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";
import { getGtmIdForRequestHost } from "@/lib/gtm-config";

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
  const gtmId = getGtmIdForRequestHost(requestHeaders.get("host"));

  return (
    <>
      {gtmId ? <GoogleTagManager gtmId={gtmId} nonce={nonce} /> : null}
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

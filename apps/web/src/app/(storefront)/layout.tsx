import { SiteHeader } from "@/app/_components/site-header";
import { StoreFooter } from "@/app/_components/store-footer";
import { CartProvider } from "@/features/cart/cart-provider";

export default function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CartProvider>
      <SiteHeader />
      {children}
      <StoreFooter />
    </CartProvider>
  );
}

import { SiteHeader } from "@/app/_components/site-header";
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
    </CartProvider>
  );
}

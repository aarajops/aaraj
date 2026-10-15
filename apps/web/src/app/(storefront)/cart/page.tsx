import type { Metadata } from "next";
import { CartPage } from "@/features/cart/cart-page";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export default async function StorefrontCartPage({
  searchParams,
}: {
  searchParams: Promise<{ merge?: string }>;
}) {
  const { merge } = await searchParams;
  const mergeMode =
    merge === "required" || merge === "retry" || merge === "cleanup"
      ? merge
      : "none";

  return <CartPage mergeMode={mergeMode} />;
}

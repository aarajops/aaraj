import { CartPage } from "@/features/cart/cart-page";

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

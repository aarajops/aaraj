import type { Metadata } from "next";
import { OrderTrackingLookup } from "@/features/orders/order-tracking-lookup";

export const metadata: Metadata = {
  title: "Track Your Order",
  description: "Check your AARAJ order's Pathao shipment status.",
  robots: { index: false, follow: false },
};

export default function TrackOrderPage() {
  return <OrderTrackingLookup />;
}

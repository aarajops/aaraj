import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CirclePause,
  CircleX,
  Clock3,
  LoaderCircle,
  Package,
  PackageCheck,
  PackageMinus,
  PhoneMissed,
  RotateCcw,
  Truck,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Order, OrderStatus, PathaoBooking } from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import {
  humanizeFulfillmentStatus,
  humanizeOrderStatus,
} from "./orders-format";

type OrderFulfillmentStatus = Order["fulfillmentStatus"];
type PathaoTrackingProgress = PathaoBooking["trackingProgress"];

type StatusIconKey =
  | OrderStatus
  | OrderFulfillmentStatus
  | PathaoTrackingProgress
  | PathaoBooking["status"]
  | "needs_review"
  | "not_booked"
  | "unavailable";

const statusIcons: Record<StatusIconKey, LucideIcon> = {
  pending: Clock3,
  no_answer: PhoneMissed,
  confirmed: CircleCheck,
  on_hold: CirclePause,
  cancelled: CircleX,
  not_started: CircleDashed,
  awaiting_dispatch: Package,
  dispatched: Truck,
  partially_delivered: PackageCheck,
  delivered: CircleCheck,
  delivery_failed: TriangleAlert,
  returned: Undo2,
  submitting: LoaderCircle,
  booked: PackageCheck,
  outcome_unknown: CircleHelp,
  reconciliation_required: TriangleAlert,
  pickup: PackageCheck,
  pickup_failed: TriangleAlert,
  in_transit: Truck,
  out_for_delivery: Truck,
  partial_delivery: PackageCheck,
  returning: RotateCcw,
  not_booked: PackageMinus,
  unavailable: CircleHelp,
  needs_review: TriangleAlert,
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const variant = status === "cancelled" ? "destructive" : "secondary";

  return (
    <StatusBadge
      className={
        status === "confirmed"
          ? "border-success/30 bg-success/10 text-success"
          : undefined
      }
      label={humanizeOrderStatus(status)}
      status={status}
      variant={variant}
    />
  );
}

export function FulfillmentStatusBadge({
  status,
}: {
  status: OrderFulfillmentStatus;
}) {
  return (
    <StatusBadge label={humanizeFulfillmentStatus(status)} status={status} />
  );
}

export function ShipmentStatusBadge({
  label,
  status,
  variant,
}: {
  label: string;
  status: StatusIconKey;
  variant?: "secondary" | "outline" | "destructive";
}) {
  return <StatusBadge label={label} status={status} variant={variant} />;
}

function StatusBadge({
  className,
  label,
  status,
  variant = "secondary",
}: {
  className?: string;
  label: string;
  status: StatusIconKey;
  variant?: "default" | "secondary" | "outline" | "destructive";
}) {
  const Icon = statusIcons[status];

  return (
    <Badge className={className} variant={variant}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Badge>
  );
}

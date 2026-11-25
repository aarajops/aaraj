import type { Order } from "@aaraj/contracts";

export type ComboBillableRow = {
  key: string;
  productName: string;
  description: string;
  quantity: number;
  unitPriceBdt: number;
  grossAmountBdt: number;
};

const POST_DISPATCH_STATUSES = new Set([
  "partially_delivered",
  "delivered",
  "delivery_failed",
  "returned",
]);

export function hasRecordedAcceptedQuantity(
  line: Order["lines"][number],
): line is Order["lines"][number] & { acceptedQuantity: number } {
  return line.acceptedQuantity !== null && line.acceptedQuantity !== undefined;
}

export function getOrderLineAcceptedQuantity(
  order: Order,
  line: Order["lines"][number],
): number {
  if (hasRecordedAcceptedQuantity(line)) {
    return line.acceptedQuantity;
  }
  if (
    order.fulfillmentStatus === "delivery_failed" ||
    order.fulfillmentStatus === "returned"
  ) {
    return 0;
  }
  return line.quantity;
}

export function getOrderLineAcceptedAmount(
  order: Order,
  line: Order["lines"][number],
): number {
  return getOrderLineAcceptedQuantity(order, line) * line.unitPriceBdt;
}

export function getOrderComboBillableRows(
  order: Order,
  group: Order["comboGroups"][number],
): ComboBillableRow[] {
  if (
    POST_DISPATCH_STATUSES.has(order.fulfillmentStatus) &&
    group.deliveryOutcome === "pending"
  ) {
    return [];
  }
  return getComboBillableRows(group);
}

export function getOrderComboBillableAmount(
  order: Order,
  group: Order["comboGroups"][number],
): number {
  return getOrderComboBillableRows(order, group).reduce(
    (total, row) => total + row.grossAmountBdt,
    0,
  );
}

export function getOrderAcceptedMerchandiseAmount(order: Order): number {
  const standaloneAmount = order.lines
    .filter((line) => line.comboGroupId === null)
    .reduce(
      (total, line) => total + getOrderLineAcceptedAmount(order, line),
      0,
    );
  const comboAmount = order.comboGroups.reduce(
    (total, group) => total + getOrderComboBillableAmount(order, group),
    0,
  );
  return standaloneAmount + comboAmount;
}

export function getOrderDiscountForAcceptedMerchandise(
  order: Order,
  acceptedMerchandiseBdt = getOrderAcceptedMerchandiseAmount(order),
): number {
  if (!POST_DISPATCH_STATUSES.has(order.fulfillmentStatus)) {
    return order.manualDiscountBdt;
  }
  if (acceptedMerchandiseBdt === 0) return 0;
  if (
    !order.lines.some(
      (line) => line.comboGroupId === null && hasRecordedAcceptedQuantity(line),
    )
  ) {
    return order.manualDiscountBdt;
  }
  if (order.merchandiseGrossBdt === 0) return 0;
  const discountBasis = Math.min(
    acceptedMerchandiseBdt,
    order.merchandiseGrossBdt,
  );
  return Number(
    (BigInt(order.manualDiscountBdt) * BigInt(discountBasis) +
      BigInt(order.merchandiseGrossBdt) / BigInt(2)) /
      BigInt(order.merchandiseGrossBdt),
  );
}

export function getOrderDeliveryAmount(order: Order): number {
  return POST_DISPATCH_STATUSES.has(order.fulfillmentStatus) &&
    order.codAmountDueBdt === 0
    ? 0
    : order.delivery.grossAmountBdt;
}

export function getComboBillableRows(
  group: Order["comboGroups"][number],
): ComboBillableRow[] {
  if (
    group.deliveryOutcome === "pending" ||
    group.deliveryOutcome === "complete" ||
    group.deliveryOutcome === "redelivered_complete"
  ) {
    return [
      {
        key: group.id,
        productName: group.comboName,
        description: group.selections
          .map(
            ({ productName, color, sizeLabel }) =>
              `${productName} · ${color} · ${sizeLabel}`,
          )
          .join(", "),
        quantity: group.quantity,
        unitPriceBdt: group.unitPriceBdt,
        grossAmountBdt: group.grossAmountBdt,
      },
    ];
  }

  const completeSets = Math.min(
    ...group.selections.map((selection) =>
      getAcceptedComboQuantity(group, selection),
    ),
  );
  const rows: ComboBillableRow[] = [];
  if (completeSets > 0) {
    rows.push({
      key: `${group.id}-complete`,
      productName: group.comboName,
      description: group.selections
        .map(
          ({ productName, color, sizeLabel }) =>
            `${productName} · ${color} · ${sizeLabel}`,
        )
        .join(", "),
      quantity: completeSets,
      unitPriceBdt: group.unitPriceBdt,
      grossAmountBdt: completeSets * group.unitPriceBdt,
    });
  }
  for (const selection of group.selections) {
    const quantity = getAcceptedComboQuantity(group, selection) - completeSets;
    if (quantity <= 0) continue;
    rows.push({
      key: `${group.id}-${selection.selectionIndex ?? selection.componentId}`,
      productName: selection.productName,
      description: `${selection.color} · ${selection.sizeLabel}`,
      quantity,
      unitPriceBdt: selection.unitPriceBdt,
      grossAmountBdt: quantity * selection.unitPriceBdt,
    });
  }
  return rows;
}

export function getAcceptedComboQuantity(
  group: Order["comboGroups"][number],
  selection: Order["comboGroups"][number]["selections"][number],
): number {
  return (
    group.acceptedComponents.find((accepted) =>
      selection.selectionIndex === undefined
        ? accepted.selectionIndex === undefined &&
          accepted.componentId === selection.componentId
        : accepted.selectionIndex === selection.selectionIndex,
    )?.quantity ?? 0
  );
}

export function getAcceptedComboSelection(
  group: Order["comboGroups"][number],
  accepted: Order["comboGroups"][number]["acceptedComponents"][number],
) {
  return group.selections.find((selection) =>
    accepted.selectionIndex === undefined
      ? selection.selectionIndex === undefined &&
        selection.componentId === accepted.componentId
      : selection.selectionIndex === accepted.selectionIndex,
  );
}

export function comboSelectionInputKey(
  selection: Order["comboGroups"][number]["selections"][number],
): string {
  return selection.selectionIndex === undefined
    ? `component:${selection.componentId}`
    : `selection:${selection.selectionIndex}`;
}

export function getComboBillableAmount(
  group: Order["comboGroups"][number],
): number {
  return getComboBillableRows(group).reduce(
    (total, row) => total + row.grossAmountBdt,
    0,
  );
}

export function humanize(value: string): string {
  return value
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizeOrderStatus(status: string): string {
  if (status === "no_answer") return "No answer";
  return humanize(status);
}

export function humanizeFulfillmentStatus(
  status: Order["fulfillmentStatus"],
): string {
  if (status === "awaiting_dispatch") return "Awaiting pickup";
  if (status === "dispatched") return "Picked up";
  return humanize(status);
}

export function humanizePathaoStatus(value: string): string {
  const status = value.replace(/^order\./, "");
  if (status === "pickup" || status === "picked") return "Picked up";
  return status
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

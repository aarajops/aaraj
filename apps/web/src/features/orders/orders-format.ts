import type { Order } from "@aaraj/contracts";

export type ComboBillableRow = {
  key: string;
  productName: string;
  description: string;
  quantity: number;
  unitPriceBdt: number;
  grossAmountBdt: number;
};

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

import type { CatalogPrice } from "@aaraj/contracts";

const MAX_PRICE_BDT = 2_147_483_647;

export function parseBdtPrice(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const amountBdt = Number(normalized);
  return Number.isSafeInteger(amountBdt) &&
    amountBdt >= 0 &&
    amountBdt <= MAX_PRICE_BDT
    ? amountBdt
    : null;
}

export function formatBdtInput(amountBdt: number | null): string {
  return amountBdt !== null &&
    Number.isSafeInteger(amountBdt) &&
    amountBdt >= 0 &&
    amountBdt <= MAX_PRICE_BDT
    ? amountBdt.toString()
    : "";
}

export function formatCatalogPrice(price: CatalogPrice): string {
  const formattedAmount = new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: 0,
  }).format(price.amountBdt);
  return `৳${formattedAmount}`;
}

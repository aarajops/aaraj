const bdtNumberFormat = new Intl.NumberFormat("en-BD", {
  maximumFractionDigits: 0,
});

export function formatBdtPrice(price: { amountBdt: number }): string {
  return `৳${bdtNumberFormat.format(price.amountBdt)}`;
}

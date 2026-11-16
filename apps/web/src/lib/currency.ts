const bdtPriceFormat = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
  style: "currency",
});

export function formatBdtPrice(price: { amountBdt: number }): string {
  return bdtPriceFormat.format(price.amountBdt);
}

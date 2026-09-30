const priceFormatterCache = new Map<string, Intl.NumberFormat>();

export function getPriceFormatter(currency: string): Intl.NumberFormat {
  let formatter = priceFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    priceFormatterCache.set(currency, formatter);
  }
  return formatter;
}

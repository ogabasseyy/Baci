// Module-scope cache: only minimumFractionDigits varies (0 for integers, 2 otherwise).
const nairaFormatterCache = new Map<number, Intl.NumberFormat>();
function getNairaFormatter(minimumFractionDigits: number): Intl.NumberFormat {
  let formatter = nairaFormatterCache.get(minimumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      currency: 'NGN',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 2,
      minimumFractionDigits,
      style: 'currency',
    });
    nairaFormatterCache.set(minimumFractionDigits, formatter);
  }
  return formatter;
}

/** A naira amount for customer messages: "₦1,000" or "₦1,000.50". */
export function formatNaira(amount: number): string {
  return getNairaFormatter(Number.isInteger(amount) ? 0 : 2).format(amount);
}

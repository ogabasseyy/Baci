export function formatAdminReconciliationMoney(
  value: number,
  currency: string
): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  const options = {
    maximumFractionDigits: value >= 1000 ? 1 : 2,
    notation: value >= 1000 ? 'compact' : 'standard',
  } as const;

  if (normalizedCurrency === 'UNK' || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return `UNK ${new Intl.NumberFormat('en', options).format(value)}`;
  }

  return new Intl.NumberFormat('en', {
    ...options,
    currency: normalizedCurrency,
    currencyDisplay: 'narrowSymbol',
    style: 'currency',
  }).format(value);
}

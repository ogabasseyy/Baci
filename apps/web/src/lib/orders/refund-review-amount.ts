function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      currency,
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * Total of the review's candidate legs, formatted in their own currency.
 * Legs in different currencies are never summed: the amount is omitted
 * instead of showing a figure in the wrong currency.
 */
export function reviewAmountText(
  candidates: unknown,
  orderCurrency: string | null
): string | null {
  if (!Array.isArray(candidates)) return null;
  const totals = new Map<string, number>();
  for (const candidate of candidates) {
    const leg = candidate as { amount?: unknown; currency?: unknown } | null;
    const amount = Number(leg?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency =
      typeof leg?.currency === 'string' && leg.currency.length > 0
        ? leg.currency.toUpperCase()
        : (orderCurrency ?? 'NGN').toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  if (totals.size !== 1) return null;
  const [[currency, total]] = [...totals.entries()];
  return formatAmount(total, currency);
}

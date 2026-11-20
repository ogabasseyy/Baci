interface RawBillItemLike {
  Amount?: number | string;
  amount?: number | string;
  IsAmountFixed?: boolean;
  isAmountFixed?: boolean;
  IsFixedPrice?: boolean;
  isFixedPrice?: boolean;
  BillItems?: unknown[];
  billItems?: unknown[];
}

/**
 * The fixed prices, as Kuda sent them (kobo), in raw bill items of either
 * casing at any depth. Read before any item is mapped or dropped, so a
 * per-list guard in the mapper cannot hide the evidence from the whole-answer
 * unit check.
 */
export function collectRawFixedPricesKobo(
  rawItems: unknown[] | undefined,
  prices: number[] = []
): number[] {
  for (const raw of rawItems ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as RawBillItemLike;
    const isFixed =
      item.IsAmountFixed ??
      item.isAmountFixed ??
      item.IsFixedPrice ??
      item.isFixedPrice ??
      false;
    const rawAmount = item.Amount ?? item.amount;
    // Same grouped-figure tolerance as the mapper ("950,000" reads 950000).
    const amount =
      typeof rawAmount === 'string'
        ? Number(rawAmount.replace(/[,\s]/g, ''))
        : typeof rawAmount === 'number'
          ? rawAmount
          : Number.NaN;
    if (isFixed && Number.isFinite(amount) && amount > 0) prices.push(amount);
    collectRawFixedPricesKobo(item.BillItems ?? item.billItems, prices);
  }
  return prices;
}

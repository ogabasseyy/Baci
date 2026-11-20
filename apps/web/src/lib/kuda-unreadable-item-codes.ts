import { normalizeKudaString } from './kuda-voucher-token';

interface RawItemLike {
  ItemCode?: unknown;
  itemCode?: unknown;
  KudaIdentifier?: unknown;
  kudaIdentifier?: unknown;
  Amount?: unknown;
  amount?: unknown;
  IsAmountFixed?: unknown;
  isAmountFixed?: unknown;
  IsFixedPrice?: unknown;
  isFixedPrice?: unknown;
  BillItems?: unknown;
  billItems?: unknown;
}

function readAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replace(/[,\s]/g, '');
  return cleaned === '' ? Number.NaN : Number(cleaned);
}

/**
 * Codes of fixed-price items, at any depth, whose price the mapper cannot
 * use (blank, unreadable, zero or less) and therefore drops. The price
 * recheck needs them: a dropped listing would otherwise look as if its
 * biller never offered the package, letting another biller's price stand
 * in for it.
 */
export function collectUnreadableFixedItemCodes(
  rawItems: unknown,
  codes: string[] = []
): string[] {
  if (!Array.isArray(rawItems)) return codes;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as RawItemLike;
    const isFixed =
      (item.IsAmountFixed ??
        item.isAmountFixed ??
        item.IsFixedPrice ??
        item.isFixedPrice) === true;
    const code =
      normalizeKudaString(item.ItemCode) ??
      normalizeKudaString(item.itemCode) ??
      normalizeKudaString(item.KudaIdentifier) ??
      normalizeKudaString(item.kudaIdentifier);
    if (isFixed && code && !(readAmount(item.Amount ?? item.amount) > 0)) {
      codes.push(code);
    }
    collectUnreadableFixedItemCodes(item.BillItems ?? item.billItems, codes);
  }
  return codes;
}

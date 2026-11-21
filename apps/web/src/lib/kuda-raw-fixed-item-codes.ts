import { normalizeKudaString } from './kuda-voucher-token';

interface RawItemLike {
  ItemCode?: unknown;
  itemCode?: unknown;
  KudaIdentifier?: unknown;
  kudaIdentifier?: unknown;
  IsAmountFixed?: unknown;
  isAmountFixed?: unknown;
  IsFixedPrice?: unknown;
  isFixedPrice?: unknown;
  BillItems?: unknown;
  billItems?: unknown;
}

/**
 * Codes of every fixed-price item, at any depth, exactly as Kuda listed
 * them (whatever their price). Compared with what the mapper kept, this
 * shows which listings it dropped, for any reason.
 */
export function collectRawFixedItemCodes(
  rawItems: unknown,
  codes: string[] = []
): string[] {
  if (!Array.isArray(rawItems)) return codes;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as RawItemLike;
    // Read like the mapper does (any truthy flag is fixed), so a dropped
    // fixed item is never missed here.
    const isFixed = Boolean(
      item.IsAmountFixed ??
        item.isAmountFixed ??
        item.IsFixedPrice ??
        item.isFixedPrice
    );
    const code =
      normalizeKudaString(item.ItemCode) ??
      normalizeKudaString(item.itemCode) ??
      normalizeKudaString(item.KudaIdentifier) ??
      normalizeKudaString(item.kudaIdentifier);
    if (isFixed && code) codes.push(code);
    collectRawFixedItemCodes(item.BillItems ?? item.billItems, codes);
  }
  return codes;
}

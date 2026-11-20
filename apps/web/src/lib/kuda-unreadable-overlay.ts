import type { Biller } from './kuda';
import type { BillItem } from './kuda-bill-items';
import { normalizeKudaItemCode } from './kuda-item-code';

function withoutCodes(
  items: BillItem[] | undefined,
  codes: Set<string>
): BillItem[] | undefined {
  if (!items) return undefined;
  const kept = items.flatMap((item) => {
    if (codes.has(normalizeKudaItemCode(item.itemCode))) return [];
    if (!item.billItems) return [item];
    const children = withoutCodes(item.billItems, codes);
    // A group whose children were all removed is dropped, never sold.
    return children ? [{ ...item, billItems: children }] : [];
  });
  return kept.length > 0 ? kept : undefined;
}

/**
 * The saved price list, corrected by a fresh Kuda answer that listed no
 * usable packages but did mark some as unreadable. Those packages are
 * removed from the saved list and recorded as unreadable on their biller,
 * so the saved (older) price can never confirm a package Kuda's latest
 * answer says it cannot price. Everything else in the saved list stands.
 */
export function overlayUnreadableCodes(
  saved: Biller[],
  fresh: Biller[]
): Biller[] {
  const freshCodes = new Map<string, string[]>();
  for (const biller of fresh) {
    if (biller.unreadableItemCodes?.length) {
      freshCodes.set(biller.billerId, biller.unreadableItemCodes);
    }
  }
  if (freshCodes.size === 0) return saved;
  return saved.map((biller) => {
    const codes = freshCodes.get(biller.billerId);
    if (!codes) return biller;
    const normalized = new Set(codes.map(normalizeKudaItemCode));
    return {
      ...biller,
      billItems: withoutCodes(biller.billItems, normalized),
      unreadableItemCodes: [
        ...new Set([...(biller.unreadableItemCodes ?? []), ...codes]),
      ],
    };
  });
}

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

function billerKey(biller: Biller) {
  return biller.billerName.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The saved price list, corrected by a fresh Kuda answer that listed no
 * usable packages but did mark some as unreadable. Those packages are
 * removed from the matching saved biller (by ID, or by name if Kuda changed
 * the ID) and recorded as unreadable there; a fresh biller the saved list
 * doesn't have is added with only its unreadable codes. Either way, the
 * saved (older) price can never confirm a package Kuda's latest answer says
 * it cannot price. Everything else in the saved list stands.
 */
export function overlayUnreadableCodes(
  saved: Biller[],
  fresh: Biller[]
): Biller[] {
  const marked = fresh.filter(
    (biller) => biller.unreadableItemCodes?.length || biller.packagesUnreadable
  );
  if (marked.length === 0) return saved;
  const matched = new Set<Biller>();
  const corrected = saved.map((biller) => {
    const sources = marked.filter(
      (source) =>
        source.billerId === biller.billerId ||
        billerKey(source) === billerKey(biller)
    );
    if (sources.length === 0) return biller;
    for (const source of sources) matched.add(source);
    const codes = sources.flatMap((source) => source.unreadableItemCodes ?? []);
    // A malformed fresh package list voids every saved package of its biller.
    const voided = sources.some((source) => source.packagesUnreadable);
    return {
      ...biller,
      billItems: voided
        ? undefined
        : withoutCodes(
            biller.billItems,
            new Set(codes.map(normalizeKudaItemCode))
          ),
      ...(voided && { packagesUnreadable: true as const }),
      unreadableItemCodes: [
        ...new Set([...(biller.unreadableItemCodes ?? []), ...codes]),
      ],
    };
  });
  const added = marked
    .filter((source) => !matched.has(source))
    .map((source) => ({ ...source, billItems: undefined }));
  return [...corrected, ...added];
}

/**
 * Whether a raw Kuda item list, at any depth, has a package list that is
 * not a list (e.g. `BillItems: {}`). The mapper drops such a list, and the
 * codes inside it can't be read, so its biller's packages are unconfirmable.
 */
export function hasMalformedItemList(rawItems: unknown): boolean {
  if (rawItems === undefined || rawItems === null) return false;
  if (!Array.isArray(rawItems)) return true;
  return rawItems.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const item = raw as { BillItems?: unknown; billItems?: unknown };
    return hasMalformedItemList(item.BillItems ?? item.billItems);
  });
}

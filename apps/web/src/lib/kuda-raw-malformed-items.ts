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
 * Whether a raw Kuda item list, at any depth, can't be fully read: a package
 * list that is not a list (e.g. `BillItems: {}`), an entry that isn't an
 * object (e.g. `null`), or a fixed-price package with no code. The mapper drops either, and which package it was can't be
 * told, so its biller's packages are unconfirmable.
 */
export function hasMalformedItemList(rawItems: unknown): boolean {
  if (rawItems === undefined || rawItems === null) return false;
  if (!Array.isArray(rawItems)) return true;
  return rawItems.some((raw) => {
    // An entry that isn't an object (e.g. null) is an unreadable package.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
    const item = raw as RawItemLike;
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
    if (isFixed && !code) return true;
    return hasMalformedItemList(item.BillItems ?? item.billItems);
  });
}

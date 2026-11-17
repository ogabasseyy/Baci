import { normalizeKudaString } from './kuda-voucher-token';

/** A Kuda bill item (specific product from a biller), priced in naira. */
export interface BillItem {
  itemCode: string;
  itemName: string;
  amount: number;
  itemCurrencySymbol: string;
  isAmountFixed: boolean;
  itemFee: number;
  billItems?: BillItem[];
}

interface KudaRawBillItem {
  ItemCode?: string;
  itemCode?: string;
  KudaIdentifier?: string;
  kudaIdentifier?: string;
  ItemName?: string;
  itemName?: string;
  Name?: string;
  name?: string;
  Amount?: number | string;
  amount?: number | string;
  ItemCurrencySymbol?: string;
  itemCurrencySymbol?: string;
  IsAmountFixed?: boolean;
  isAmountFixed?: boolean;
  IsFixedPrice?: boolean;
  isFixedPrice?: boolean;
  ItemFee?: number | string;
  itemFee?: number | string;
  BillItems?: unknown[];
  billItems?: unknown[];
}

function toNumber(value: number | string | undefined, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

/**
 * Kuda's bill-item list prices items in kobo (MTN "1GB Monthly Plan" comes
 * back as 100000, StarTimes "DTT SUPER MONTHLY 9500NGN" as 950000), while the
 * rest of Baci works in naira and converts back to kobo only when it calls
 * Kuda to buy. Without this, customers saw and paid 100x the price.
 */
function koboToNaira(value: number | string | undefined) {
  return Math.round(toNumber(value)) / 100;
}

function mapBillItem(raw: unknown): BillItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as KudaRawBillItem;
  const itemCode =
    normalizeKudaString(item.ItemCode) ??
    normalizeKudaString(item.itemCode) ??
    normalizeKudaString(item.KudaIdentifier) ??
    normalizeKudaString(item.kudaIdentifier);
  const itemName =
    normalizeKudaString(item.ItemName) ??
    normalizeKudaString(item.itemName) ??
    normalizeKudaString(item.Name) ??
    normalizeKudaString(item.name);

  if (!itemCode || !itemName) {
    return null;
  }

  return {
    itemCode,
    itemName,
    amount: koboToNaira(item.Amount ?? item.amount),
    itemCurrencySymbol:
      item.ItemCurrencySymbol ?? item.itemCurrencySymbol ?? 'NGN',
    isAmountFixed:
      item.IsAmountFixed ??
      item.isAmountFixed ??
      item.IsFixedPrice ??
      item.isFixedPrice ??
      false,
    itemFee: koboToNaira(item.ItemFee ?? item.itemFee),
    billItems: mapKudaBillItems(item.BillItems ?? item.billItems),
  };
}

/** Map Kuda's raw bill items (either casing) to our bill items. */
export function mapKudaBillItems(
  rawItems: unknown[] | undefined
): BillItem[] | undefined {
  if (!rawItems || rawItems.length === 0) {
    return undefined;
  }

  const billItems = rawItems
    .map((rawItem) => mapBillItem(rawItem))
    .filter((item): item is BillItem => item !== null);

  return billItems.length > 0 ? billItems : undefined;
}

import { normalizeKudaString } from './kuda-voucher-token';
import { logger } from './logger';

/**
 * Below this many kobo (₦10) a fixed price is implausible; seeing one
 * suggests Kuda has started sending naira, which this mapping would then
 * show 100x too low.
 */
const IMPLAUSIBLE_FIXED_PRICE_KOBO = 1000;

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
  BillItems?: unknown;
  billItems?: unknown;
}

function toNumber(value: number | string | undefined, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    // Tolerate grouped figures such as "950,000" or "950 000". A blank
    // string is unreadable, not zero, so a fixed price left blank is dropped.
    const cleaned = value.replace(/[,\s]/g, '');
    if (cleaned === '') return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

/**
 * Kuda's bill-item list prices items in kobo (MTN "1GB Monthly Plan" comes
 * back as 100000, StarTimes "DTT SUPER MONTHLY 9500NGN" as 950000), while the
 * rest of Baci works in naira and converts back to kobo only when it calls
 * Kuda to buy. Without this, customers saw and paid 100x the price.
 * Every list shares this unit; Kuda's airtime items are all open-amount
 * (amount 0) in production on 2026-11-17, so the conversion leaves them as
 * they were. ItemFee is converted with the same unit as Amount. The fee is
 * never charged or sent to Kuda (purchases send only Amount), so a wrong fee
 * unit could only mis-display it; the first non-zero fee seen in production
 * should still be checked against Kuda's own figure.
 */
function koboToNaira(value: number | string | undefined) {
  return Math.round(toNumber(value)) / 100;
}

function isImplausiblyCheap(rawAmount: number, isAmountFixed: boolean) {
  return (
    isAmountFixed && rawAmount > 0 && rawAmount < IMPLAUSIBLE_FIXED_PRICE_KOBO
  );
}

/**
 * A naira price written into the item name, e.g. "9500NGN", "NGN 9,500",
 * "N9500" or "₦9,500".
 */
const NAIRA_PRICE_IN_NAME =
  /(?:₦|NGN\s?|(?<![A-Za-z])N)(\d[\d,]*)(?![\d,])|(?<![\d,])(\d[\d,]*)\s?(?:NGN|naira)\b/i;

function nairaPriceInName(itemName: string): number | undefined {
  const match = NAIRA_PRICE_IN_NAME.exec(itemName);
  const digits = (match?.[1] ?? match?.[2])?.replace(/,/g, '');
  const price = digits ? Number(digits) : Number.NaN;
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/**
 * Whether Kuda sent this fixed price in naira: the raw amount equals the
 * naira price the item's own name states (e.g. StarTimes "...9500NGN" sent
 * as 9500 instead of 950000). Mapping it as kobo would sell it 100x too
 * cheap and then charge 100x when buying.
 */
function sentInNaira(
  rawAmount: number,
  isAmountFixed: boolean,
  itemName: string
): boolean {
  const namePrice = nairaPriceInName(itemName);
  return isAmountFixed && namePrice !== undefined && rawAmount === namePrice;
}

interface MappedBillItem {
  item: BillItem;
  /**
   * A container (plan group) whose children were all rejected. Kept as it
   * is it would read as an open-amount product, which can be bought at any
   * amount, so it is dropped instead.
   */
  emptiedContainer: boolean;
  /** This fixed price suggests Kuda sent the list in naira, not kobo. */
  unitInDoubt: boolean;
}

function mapBillItem(raw: unknown): MappedBillItem | null {
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

  const rawAmount = item.Amount ?? item.amount;
  const isAmountFixed =
    item.IsAmountFixed ??
    item.isAmountFixed ??
    item.IsFixedPrice ??
    item.isFixedPrice ??
    false;
  // A fixed price that cannot be read, or is zero or less, is dropped, so it
  // is never listed as ₦0 or sold; the purchase check then treats the
  // package as unlisted. Open-amount items keep their 0.
  if (isAmountFixed && !(toNumber(rawAmount, Number.NaN) > 0)) {
    return null;
  }
  const amountValue = toNumber(rawAmount);
  const unitInDoubt =
    isImplausiblyCheap(amountValue, isAmountFixed) ||
    sentInNaira(amountValue, isAmountFixed, itemName);
  if (unitInDoubt) {
    logger.warn({
      message: 'Kuda bill item price looks like naira, not kobo',
      itemCode,
      rawAmount: amountValue,
    });
  }

  const rawChildren = item.BillItems ?? item.billItems;
  // Children that aren't a list are malformed: the container can't be
  // trusted, so it is dropped like one whose children were all rejected.
  const malformedChildren =
    rawChildren !== undefined &&
    rawChildren !== null &&
    !Array.isArray(rawChildren);
  const billItems = mapKudaBillItems(rawChildren);
  const mapped: BillItem = {
    itemCode,
    itemName,
    amount: koboToNaira(rawAmount),
    itemCurrencySymbol:
      item.ItemCurrencySymbol ?? item.itemCurrencySymbol ?? 'NGN',
    isAmountFixed,
    itemFee: koboToNaira(item.ItemFee ?? item.itemFee),
    billItems,
  };
  return {
    emptiedContainer:
      malformedChildren ||
      (!billItems && Array.isArray(rawChildren) && rawChildren.length > 0),
    item: mapped,
    unitInDoubt,
  };
}

/**
 * Map Kuda's raw bill items (either casing) to our bill items. One list
 * shares one unit, so if any fixed price in it suggests naira (under ₦10 as
 * kobo, or equal to the naira price in its own name), every fixed-price item
 * in that list is dropped: a naira list would otherwise show and confirm
 * prices 100x too low (e.g. "1GB Monthly Plan" sent as 1000 → ₦10) and then
 * charge 100x on purchase. Open-amount items stay, since they carry no price.
 */
export function mapKudaBillItems(rawItems: unknown): BillItem[] | undefined {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return undefined;
  }

  const mapped = rawItems
    .map((rawItem) => mapBillItem(rawItem))
    .filter((entry): entry is MappedBillItem => entry !== null);
  const listUnitInDoubt = mapped.some((entry) => entry.unitInDoubt);
  if (listUnitInDoubt) {
    logger.warn({
      message: 'Kuda bill item list dropped: its prices look like naira',
      droppedFixedItems: mapped.filter((entry) => entry.item.isAmountFixed)
        .length,
    });
  }
  const billItems = mapped
    .filter((entry) => !entry.emptiedContainer)
    .map((entry) => entry.item)
    .filter((item) => !(listUnitInDoubt && item.isAmountFixed));

  return billItems.length > 0 ? billItems : undefined;
}

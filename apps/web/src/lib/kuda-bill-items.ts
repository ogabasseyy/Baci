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
 * Every list shares this unit; Kuda's airtime items are all open-amount
 * (amount 0) in production on 2026-11-17, so the conversion leaves them as
 * they were. No production item had a non-zero ItemFee that day (fees are
 * display-only), so the fee conversion follows the documented amount unit.
 */
function koboToNaira(value: number | string | undefined) {
  return Math.round(toNumber(value)) / 100;
}

function warnIfUnitLooksWrong(
  rawAmount: number,
  isAmountFixed: boolean,
  itemCode: string
) {
  if (
    isAmountFixed &&
    rawAmount > 0 &&
    rawAmount < IMPLAUSIBLE_FIXED_PRICE_KOBO
  ) {
    logger.warn({
      message: 'Kuda bill item price looks like naira, not kobo',
      itemCode,
      rawAmount,
    });
  }
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
 * cheap and then charge 100x when buying, so such an item is dropped.
 */
function sentInNaira(
  rawAmount: number,
  isAmountFixed: boolean,
  itemName: string
): boolean {
  const namePrice = nairaPriceInName(itemName);
  return isAmountFixed && namePrice !== undefined && rawAmount === namePrice;
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

  const rawAmount = item.Amount ?? item.amount;
  const isAmountFixed =
    item.IsAmountFixed ??
    item.isAmountFixed ??
    item.IsFixedPrice ??
    item.isFixedPrice ??
    false;
  // A fixed price that cannot be read is dropped, so it is never listed as
  // ₦0 or sold; the purchase check then treats the package as unlisted.
  if (isAmountFixed && !Number.isFinite(toNumber(rawAmount, Number.NaN))) {
    return null;
  }
  warnIfUnitLooksWrong(toNumber(rawAmount), isAmountFixed, itemCode);
  if (sentInNaira(toNumber(rawAmount), isAmountFixed, itemName)) {
    logger.warn({
      message: 'Kuda bill item price matches its name in naira, not kobo',
      itemCode,
      rawAmount: toNumber(rawAmount),
    });
    return null;
  }

  return {
    itemCode,
    itemName,
    amount: koboToNaira(rawAmount),
    itemCurrencySymbol:
      item.ItemCurrencySymbol ?? item.itemCurrencySymbol ?? 'NGN',
    isAmountFixed,
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

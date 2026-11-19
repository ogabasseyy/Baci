import { logger } from './logger';

/**
 * The purchase API rejects any amount under ₦50 (schemas/vtu.ts), so a fixed
 * price below that is never sold. In a list priced in kobo none exists (the
 * cheapest production price is exactly ₦50, i.e. 5000 kobo).
 */
const MIN_SELLABLE_PRICE_KOBO = 5000;
/** Too few fixed prices to tell a unit change from a one-off cheap item. */
const MIN_FIXED_PRICES_TO_JUDGE = 5;
/**
 * Share of fixed prices under the floor that marks the whole answer as naira.
 * A kobo list has none; a naira list read as kobo has about half (production
 * data bundles 52%, cable packages 43%), so this separates them widely.
 */
const NAIRA_LIST_SHARE = 0.1;

export const KUDA_BILL_LIST_UNIT_ERROR =
  'Bill prices could not be confirmed as kobo';

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
 * casing at any depth. Read before any item is mapped or dropped, so the
 * judgement below cannot be hidden by a per-list guard removing the evidence.
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

/**
 * Whether a Kuda answer looks like it was really priced in naira: a large
 * share of its fixed prices, read as kobo, land under the ₦50 purchase floor
 * (a naira list read as kobo comes out 100x too low). It judges the whole
 * answer, so it works whatever the item names say and whichever billers
 * happen to list a cheap item.
 */
export function looksLikeNairaPricedList(rawFixedPricesKobo: number[]): {
  belowFloor: number;
  fixedPrices: number;
  isNaira: boolean;
} {
  const belowFloor = rawFixedPricesKobo.filter(
    (price) => price < MIN_SELLABLE_PRICE_KOBO
  ).length;
  const fixedPrices = rawFixedPricesKobo.length;
  return {
    belowFloor,
    fixedPrices,
    isNaira:
      fixedPrices >= MIN_FIXED_PRICES_TO_JUDGE &&
      belowFloor / fixedPrices >= NAIRA_LIST_SHARE,
  };
}

/**
 * Refuse a Kuda answer that looks priced in naira instead of kobo. Every
 * caller already treats a failed Kuda fetch as "no confirmed prices" (last
 * good list from the past day, else the purchase fails closed), so a list
 * 100x too cheap is never shown or sold.
 */
export function assertKudaBillListInKobo(
  rawFixedPricesKobo: number[],
  billTypeName: string
): void {
  const verdict = looksLikeNairaPricedList(rawFixedPricesKobo);
  if (!verdict.isNaira) return;
  logger.error({
    message: 'Kuda bill list looks priced in naira, not kobo; refusing it',
    billTypeName,
    belowFloor: verdict.belowFloor,
    fixedPrices: verdict.fixedPrices,
  });
  throw new Error(KUDA_BILL_LIST_UNIT_ERROR);
}

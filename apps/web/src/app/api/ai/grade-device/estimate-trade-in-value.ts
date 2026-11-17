import { createAnonClient } from '@/lib/supabase/anon';
import type { DeviceGradingAiResult } from '@/schemas/device-grading';

/**
 * Share of the store's own selling price offered for a traded-in device.
 * The gap covers testing, refurbishment, warranty and resale margin
 * (owner decision 2026-11-15; adjust here).
 */
const GRADE_OFFER_PERCENT: Record<DeviceGradingAiResult['grade'], number> = {
  Excellent: 70,
  Good: 60,
  Fair: 50,
  Poor: 30,
};

/**
 * Listings fetched per check (name and price only), so accessories can be
 * skipped in code. Sized so a store's cheap accessories for one model cannot
 * fill the whole window and hide the device listing behind them.
 */
const MATCH_LIMIT = 100;

/**
 * A model name also appears in accessory listings ("iPhone 13 Pro case").
 * Those are far cheaper than the device and must never set the base price.
 */
const ACCESSORY_NAME =
  /\b(case|cover|pouch|skin|protector|tempered|glass|charger|cable|adapter|adaptor|earphones?|earbuds?|headphones?|strap|band|holder|stand|battery|lens|stylus|sticker)\b/i;

export interface TradeInEstimate {
  basePrice: number;
  deductionPercent: number;
  estimatedValue: number;
  matchedProduct: string;
}

/** `%`, `_` and `\` are pattern characters in ILIKE; the model name is data. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Prices the graded device against the resolved store's own active catalogue,
 * starting from the cheapest matching device listing (accessories are
 * skipped): the media cannot show storage
 * size, and staff can raise an offer in chat more easily than lower one.
 * A failed or empty lookup yields no estimate (0) rather than failing the
 * check: the customer still gets a grade and continues with support.
 */
export async function estimateTradeInValue(
  merchantId: string,
  grading: DeviceGradingAiResult
): Promise<TradeInEstimate> {
  const offerPercent = GRADE_OFFER_PERCENT[grading.grade];
  const { data, error } = await createAnonClient()
    .from('products')
    .select('name, price')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .ilike('name', `%${escapeLikePattern(grading.model)}%`)
    .gt('price', 0)
    .order('price', { ascending: true })
    .limit(MATCH_LIMIT)
    .returns<Array<{ name: string; price: number }>>();

  if (error) {
    console.error('[grade-device] product lookup failed', {
      code: error.code,
    });
  }

  const match = error
    ? undefined
    : data?.find((product) => !ACCESSORY_NAME.test(product.name));
  const basePrice =
    match && Number.isFinite(match.price) && match.price > 0 ? match.price : 0;

  return {
    basePrice,
    deductionPercent: 100 - offerPercent,
    estimatedValue: Math.round((basePrice * offerPercent) / 100),
    matchedProduct: basePrice > 0 && match ? match.name : 'Unknown Device',
  };
}

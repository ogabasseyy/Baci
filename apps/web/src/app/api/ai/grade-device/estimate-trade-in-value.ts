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

/** Listings fetched per page (name and price only). */
const PAGE_SIZE = 100;

/**
 * Pages read before giving up. Results are cheapest-first, so a store's
 * accessories for a model come before the device; paging keeps them from
 * hiding it while bounding the work for one check.
 */
const MAX_PAGES = 5;

interface ProductMatch {
  name: string;
  price: number;
}

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

/** The store's cheapest active listing for the model that is not an accessory. */
async function findCheapestDevice(
  merchantId: string,
  model: string
): Promise<ProductMatch | undefined> {
  const pattern = `%${escapeLikePattern(model)}%`;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await createAnonClient()
      .from('products')
      .select('name, price')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .ilike('name', pattern)
      .gt('price', 0)
      .order('price', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .returns<ProductMatch[]>();

    if (error) {
      console.error('[grade-device] product lookup failed', {
        code: error.code,
      });
      return undefined;
    }

    const device = data?.find((product) => !ACCESSORY_NAME.test(product.name));
    if (device || !data || data.length < PAGE_SIZE) return device;
  }

  return undefined;
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
  const match = await findCheapestDevice(merchantId, grading.model);
  const basePrice =
    match && Number.isFinite(match.price) && match.price > 0 ? match.price : 0;

  return {
    basePrice,
    deductionPercent: 100 - offerPercent,
    estimatedValue: Math.round((basePrice * offerPercent) / 100),
    matchedProduct: basePrice > 0 && match ? match.name : 'Unknown Device',
  };
}

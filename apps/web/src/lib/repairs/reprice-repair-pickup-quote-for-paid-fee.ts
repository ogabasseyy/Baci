import {
  GIGL_PLATFORM_MARGIN_BPS,
  GIGL_PRICING_VERSION,
  priceGiglQuote,
} from '../shipping/gigl-platform-pricing';
import { priceGiglQuoteUnroundedV1 } from '../shipping/gigl-platform-pricing-unrounded-v1';
import { repriceGiglQuoteForPaidFee } from '../shipping/reprice-gigl-quote-for-paid-fee';
import { toKobo } from '../shipping/to-kobo';
import type { ShippingQuote } from '../shipping/types';

type RepairPickupQuote = Pick<
  ShippingQuote,
  | 'provider'
  | 'price'
  | 'providerCost'
  | 'platformMargin'
  | 'marginBasisPoints'
  | 'pricingVersion'
>;

/**
 * Repair pickups paid under the unrounded v1 rule were accepted whenever the
 * fresh quote was at or below the paid fee. NGN 100 rounding can push the
 * fresh price above that fee even when GIG's cost fell, so a quote whose
 * rounded price exceeds the paid fee is re-priced at the unrounded v1 price
 * when that price does not exceed the paid fee (and is still at least cost +
 * 10%). Any other quote is returned unchanged. Repair pickups only: order
 * shipping keeps the exact-match check in `repriceGiglQuoteForPaidFee`.
 */
export function repriceRepairPickupQuoteForPaidFee<T extends RepairPickupQuote>(
  quote: T,
  paidPickupFee: number | string | null | undefined
): T {
  const exact = repriceGiglQuoteForPaidFee(quote, paidPickupFee);
  const paidKobo = toKobo(paidPickupFee);
  const providerCost = exact.providerCost;
  const priceKobo = toKobo(exact.price);
  if (
    exact !== quote ||
    quote.provider !== 'GIGL' ||
    quote.pricingVersion !== GIGL_PRICING_VERSION ||
    quote.marginBasisPoints !== GIGL_PLATFORM_MARGIN_BPS ||
    typeof providerCost !== 'number' ||
    paidKobo === null ||
    priceKobo === null ||
    priceKobo <= paidKobo
  ) {
    return exact;
  }
  try {
    const rounded = priceGiglQuote(providerCost);
    const unrounded = priceGiglQuoteUnroundedV1(providerCost);
    if (
      toKobo(rounded.price) !== priceKobo ||
      toKobo(unrounded.price) === null ||
      (toKobo(unrounded.price) as number) > paidKobo
    ) {
      return exact;
    }
    return {
      ...quote,
      price: unrounded.price,
      providerCost: unrounded.providerCost,
      platformMargin: unrounded.platformMargin,
    };
  } catch {
    return exact;
  }
}

import {
  GIGL_PLATFORM_MARGIN_BPS,
  GIGL_PRICING_VERSION,
  priceGiglQuote,
} from './gigl-platform-pricing';
import { priceGiglQuoteUnroundedV1 } from './gigl-platform-pricing-unrounded-v1';
import { toKobo } from './to-kobo';
import type { ShippingQuote } from './types';

type RepriceableGiglQuote = Pick<
  ShippingQuote,
  | 'provider'
  | 'price'
  | 'providerCost'
  | 'platformMargin'
  | 'marginBasisPoints'
  | 'pricingVersion'
>;

/**
 * Orders paid before GIGL prices were rounded up to whole NGN 100 hold a fee
 * from the unrounded v1 rule. When a fresh GIGL quote for such an order differs
 * from the paid fee only because of that rounding (its price is the rounded v1
 * price of its provider cost, and the unrounded v1 rule applied to that cost
 * reproduces the paid fee exactly), re-price the replacement at the unrounded
 * v1 price and margin: still v1, still at least cost + 10%, and never more than
 * the customer paid. The database accepts both v1 prices. Every other quote is
 * returned unchanged, so a real tariff change still fails the caller's
 * paid-fee check.
 */
export function repriceGiglQuoteForPaidFee<T extends RepriceableGiglQuote>(
  quote: T,
  paidShippingFee: number | string | null | undefined
): T {
  const paidKobo = toKobo(paidShippingFee);
  const providerCost = quote.providerCost;
  if (
    quote.provider !== 'GIGL' ||
    quote.pricingVersion !== GIGL_PRICING_VERSION ||
    quote.marginBasisPoints !== GIGL_PLATFORM_MARGIN_BPS ||
    typeof providerCost !== 'number' ||
    paidKobo === null ||
    toKobo(quote.price) === paidKobo
  ) {
    return quote;
  }
  let rounded: ReturnType<typeof priceGiglQuote>;
  let unrounded: ReturnType<typeof priceGiglQuoteUnroundedV1>;
  try {
    rounded = priceGiglQuote(providerCost);
    unrounded = priceGiglQuoteUnroundedV1(providerCost);
  } catch {
    return quote;
  }
  if (
    toKobo(rounded.price) !== toKobo(quote.price) ||
    toKobo(unrounded.price) !== paidKobo
  ) {
    return quote;
  }
  return {
    ...quote,
    price: unrounded.price,
    providerCost: unrounded.providerCost,
    platformMargin: unrounded.platformMargin,
  };
}

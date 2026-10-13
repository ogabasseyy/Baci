/**
 * Quote ranking and display helpers for shipping checkout.
 */

import type { DeliveryTier, ShippingQuote } from './types';
import { mapToDeliveryTier, TIER_DISPLAY_NAMES } from './types';

// =============================================================================
// QUOTE RANKING
// =============================================================================

interface RankedQuote extends ShippingQuote {
  score: number;
  tier: DeliveryTier;
}

/**
 * Scoring ETA (in days) applied to quotes with an UNKNOWN estimate.
 *
 * `estimatedDays <= 0` is the "unknown ETA" sentinel carried by
 * merchant-configured rates without configured delivery days (see
 * `MERCHANT_RATE_UNKNOWN_ESTIMATED_DAYS`). Left as 0 it would be scored as the
 * fastest possible delivery, letting a pricier no-ETA merchant rate sort ahead
 * of a cheaper carrier quote with a real ETA in `quotes.all` — which checkout
 * auto-selects the first door quote from. We instead score it as a large
 * worst-case ETA so a known-ETA carrier is never out-ranked purely because a
 * merchant rate hid its delivery time. Carriers always report
 * `estimatedDays > 0`, so their scoring is unchanged.
 */
const UNKNOWN_ETA_SCORING_DAYS = 14;

/**
 * Calculate a score for ranking quotes
 * Lower score = better (shown first)
 */
function calculateQuoteScore(quote: ShippingQuote): number {
  let score = 0;

  // Price factor (normalized to 0-50 range)
  // Lower price = lower score
  score += Math.min(quote.price / 200, 50);

  // Speed factor (0-30 range)
  // Faster = lower score. `estimatedDays <= 0` is the unknown-ETA sentinel —
  // score it as a worst-case ETA instead of 0 so a no-ETA rate never appears
  // "fastest" and out-ranks a cheaper, real-ETA carrier quote.
  const scoringEstimatedDays =
    quote.estimatedDays > 0 ? quote.estimatedDays : UNKNOWN_ETA_SCORING_DAYS;
  score += scoringEstimatedDays * 5;

  // Reliability bonus (carriers we trust)
  const trustedCarriers = ['DHL', 'FedEx', 'UPS', 'GIG Logistics'];
  if (trustedCarriers.some((c) => quote.carrierName.includes(c))) {
    score -= 10;
  }

  // Station pickup penalty (customers prefer home delivery)
  if (quote.isStationPickup) {
    score += 20;
  }

  return score;
}

/**
 * Rank and categorize quotes, best (lowest score) first.
 *
 * Exported so the quotes route can order the MERGED carrier + merchant-rate
 * list with the exact same scoring the aggregator applies to carrier-only
 * quotes. Without this, merchant rates were simply appended after carriers, so
 * a cheaper merchant rate never sorted ahead of a pricier carrier and checkout
 * (which auto-selects the first door quote) could never auto-pick it.
 */
export function rankQuotes(quotes: ShippingQuote[]): RankedQuote[] {
  return quotes
    .map((quote) => ({
      ...quote,
      score: calculateQuoteScore(quote),
      tier: mapToDeliveryTier(quote.serviceTier, quote.estimatedDays),
    }))
    .sort((a, b) => a.score - b.score);
}

/**
 * Select featured quotes (top 3: cheapest, fastest, recommended).
 *
 * Exported so the quotes route can re-bucket `featured` after merging
 * merchant-configured rate quotes with carrier quotes. Ranking is recomputed
 * internally, so callers may pass any `ShippingQuote` list.
 */
export function selectFeaturedQuotes(quotes: ShippingQuote[]): ShippingQuote[] {
  const rankedQuotes = rankQuotes(quotes);
  if (rankedQuotes.length === 0) {
    return [];
  }

  const featured: ShippingQuote[] = [];
  const usedIds = new Set<string>();

  // 1. Cheapest option
  const cheapest = rankedQuotes
    .filter((q) => !q.isStationPickup) // Prefer home delivery
    .sort((a, b) => a.price - b.price)[0];
  if (cheapest && !usedIds.has(cheapest.id)) {
    featured.push({
      ...cheapest,
      displayName: `${TIER_DISPLAY_NAMES.economy.icon} Economy Delivery`,
    });
    usedIds.add(cheapest.id);
  }

  // 2. Fastest option
  // `estimatedDays <= 0` is the "unknown estimate" sentinel carried by
  // merchant-configured rates without delivery days — never surface those as
  // the "fastest" pick (a 0-day badge would be a cosmetic lie).
  const fastest = rankedQuotes
    .filter(
      (q) => !usedIds.has(q.id) && !q.isStationPickup && q.estimatedDays > 0
    )
    .sort((a, b) => a.estimatedDays - b.estimatedDays)[0];
  if (fastest && !usedIds.has(fastest.id)) {
    featured.push({
      ...fastest,
      displayName: `${TIER_DISPLAY_NAMES.express.icon} Express Delivery`,
    });
    usedIds.add(fastest.id);
  }

  // 3. Recommended (best value - balance of price and speed)
  const recommended = rankedQuotes
    .filter((q) => !usedIds.has(q.id) && !q.isStationPickup)
    .sort((a, b) => a.score - b.score)[0];
  if (recommended && !usedIds.has(recommended.id)) {
    featured.push({
      ...recommended,
      displayName: `${TIER_DISPLAY_NAMES.standard.icon} Standard Delivery`,
    });
    usedIds.add(recommended.id);
  }

  // If we still have less than 3 and there are station pickup options, add one
  if (featured.length < 3) {
    const stationPickup = rankedQuotes.filter(
      (q) => !usedIds.has(q.id) && q.isStationPickup
    )[0];
    if (stationPickup) {
      featured.push(stationPickup);
    }
  }

  return featured;
}

// =============================================================================
// QUOTE UTILITIES
// =============================================================================

/**
 * Format price for display
 */
const _shippingPriceFormatterCache = new Map<string, Intl.NumberFormat>();

function getShippingPriceFormatter(currency: string): Intl.NumberFormat {
  let formatter = _shippingPriceFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    _shippingPriceFormatterCache.set(currency, formatter);
  }
  return formatter;
}

export function formatShippingPrice(
  price: number,
  currency: string = 'NGN'
): string {
  return getShippingPriceFormatter(currency).format(price);
}

/**
 * Format delivery estimate for display
 */
export function formatDeliveryEstimate(
  estimatedDays: number,
  minDays?: number,
  maxDays?: number
): string {
  if (minDays !== undefined && maxDays !== undefined && minDays !== maxDays) {
    return `${minDays}-${maxDays} business days`;
  }
  return `${estimatedDays} business day${estimatedDays > 1 ? 's' : ''}`;
}

/**
 * Group quotes by tier for display
 */
export function groupQuotesByTier(
  quotes: ShippingQuote[]
): Record<DeliveryTier, ShippingQuote[]> {
  const grouped: Record<DeliveryTier, ShippingQuote[]> = {
    express: [],
    premium: [],
    standard: [],
    economy: [],
  };

  quotes.forEach((quote) => {
    const tier = mapToDeliveryTier(quote.serviceTier, quote.estimatedDays);
    grouped[tier].push(quote);
  });

  // Sort each group by price
  Object.keys(grouped).forEach((tier) => {
    grouped[tier as DeliveryTier].sort((a, b) => a.price - b.price);
  });

  return grouped;
}

/**
 * Check if quotes have expired
 */
export function hasQuotesExpired(expiresAt: string | Date): boolean {
  const expiry =
    typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return Date.now() > expiry.getTime();
}

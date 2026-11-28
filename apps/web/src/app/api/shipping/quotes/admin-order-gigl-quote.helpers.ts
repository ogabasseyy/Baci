import type { ShippingQuote } from '@/lib/shipping/types';
import { toPublicQuoteResponse } from './public-quote-response';

export function selectEligibleAdminGiglQuote(quotes: ShippingQuote[]) {
  return (
    quotes
      .filter(
        (quote) =>
          quote.provider === 'GIGL' &&
          quote.currency === 'NGN' &&
          !quote.isStationPickup &&
          quote.price > 0
      )
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}

export { calculateAdminWalletFunding } from '@/lib/shipping/calculate-admin-wallet-funding';

export function toAdminPublicQuote(quote: ShippingQuote) {
  return toPublicQuoteResponse({
    quotes: { featured: [quote], all: [quote] },
    sessionId: quote.id,
    expiresAt: quote.expiresAt.toISOString(),
  }).quotes.featured[0];
}

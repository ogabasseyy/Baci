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

export function calculateAdminWalletFunding(price: number, balance: number) {
  const availableBalance = Math.max(0, Number.isFinite(balance) ? balance : 0);
  const shortfall = Math.max(0, price - availableBalance);
  return { availableBalance, shortfall, canBook: shortfall === 0 };
}

export function toAdminPublicQuote(quote: ShippingQuote) {
  return toPublicQuoteResponse({
    quotes: { featured: [quote], all: [quote] },
    sessionId: quote.id,
    expiresAt: quote.expiresAt.toISOString(),
  }).quotes.featured[0];
}

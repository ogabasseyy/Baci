import type { ShippingQuote } from '../types';

/**
 * Match a previously chosen shipping service after quote IDs are regenerated.
 * Carrier quotes mint a fresh UUID on every fetch; `providerRateId` is stable.
 */
export function findQuoteByStableIdentity(
  quotes: ShippingQuote[],
  preferred: {
    quoteId?: string | null;
    providerRateId?: string | null;
  },
): ShippingQuote | undefined {
  const preferredQuoteId = preferred.quoteId?.trim() || '';
  const preferredProviderRateId = preferred.providerRateId?.trim() || '';

  if (preferredQuoteId) {
    const byId = quotes.find(
      (quote) => String(quote.id) === String(preferredQuoteId),
    );
    if (byId) return byId;
  }

  if (preferredProviderRateId) {
    return quotes.find(
      (quote) =>
        Boolean(quote.providerRateId) &&
        String(quote.providerRateId) === preferredProviderRateId,
    );
  }

  return undefined;
}

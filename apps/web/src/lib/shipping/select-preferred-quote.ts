import { matchesGiglProviderRate } from './matches-gigl-provider-rate';
import type { ShippingQuote } from './types';

export function selectPreferredQuote(
  quotes: ShippingQuote[],
  currentQuote: {
    serviceTier: string | null;
    carrierName: string | null;
    providerRateId?: string | null;
    // Paid amount fallback: when no saved preference exists (the original
    // quote row is gone), prefer the candidate matching what the order paid
    // over the provider's default first ordering.
    samePrice?: number | null;
  }
): ShippingQuote | null {
  const normalizedServiceTier = currentQuote.serviceTier?.toLowerCase() ?? null;
  const normalizedCarrierName = currentQuote.carrierName?.toLowerCase() ?? null;
  const normalizedProviderRateId = currentQuote.providerRateId?.trim() || null;
  const hasPreference =
    normalizedServiceTier !== null ||
    normalizedCarrierName !== null ||
    normalizedProviderRateId !== null;

  return (
    quotes.find(
      (quote) =>
        normalizedProviderRateId &&
        quote.providerRateId === normalizedProviderRateId
    ) ||
    quotes.find(
      (quote) =>
        normalizedProviderRateId &&
        matchesGiglProviderRate(normalizedProviderRateId, quote.providerRateId)
    ) ||
    quotes.find(
      (quote) =>
        quote.serviceTier.toLowerCase() === normalizedServiceTier &&
        quote.carrierName.toLowerCase() === normalizedCarrierName
    ) ||
    quotes.find(
      (quote) => quote.serviceTier.toLowerCase() === normalizedServiceTier
    ) ||
    (!hasPreference && currentQuote.samePrice != null
      ? quotes.find((quote) => quote.price === currentQuote.samePrice)
      : undefined) ||
    quotes[0] ||
    null
  );
}

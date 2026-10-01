import type { ShippingQuote } from '@/lib/shipping/types';

export function selectRepairPickupQuote(
  quotes: ShippingQuote[]
): ShippingQuote | null {
  return (
    quotes
      .filter((quote) => quote.price > 0 && !quote.isStationPickup)
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}

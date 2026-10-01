import type { ShippingQuote } from './types';
import { isStationPickupQuote } from './is-station-pickup-quote';

export function isGiglGoFasterQuote(quote: ShippingQuote | undefined): boolean {
  return (
    quote !== undefined &&
    !isStationPickupQuote(quote) &&
    quote.provider.toUpperCase() === 'GIGL' &&
    quote.serviceTier.toLowerCase().includes('gofaster')
  );
}

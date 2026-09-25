import { AUTO_FRACTION_OPTIONS } from '@/lib/currency';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';
import type { ShippingQuote } from '@/types/shipping-quote';
import { SmartQuoteLoader } from '../../../components/SmartQuoteLoader';
import { getPickupStationCopy } from '../utils';

export function StationPickupOptions({
  isLoadingQuotes,
  stationPickupQuote,
  stationPickupQuotes,
  selectedQuoteId,
  setSelectedQuoteId,
}: {
  isLoadingQuotes: boolean;
  stationPickupQuote: ShippingQuote | undefined;
  stationPickupQuotes: ShippingQuote[];
  selectedQuoteId: string;
  setSelectedQuoteId: (id: string) => void;
}) {
  return isLoadingQuotes ? (
    <SmartQuoteLoader />
  ) : stationPickupQuotes.length > 0 ? (
    // A merchant/GIGL zone can expose several pickup
    // locations: render every one as an individually
    // selectable option instead of collapsing to the
    // first. Copy is provider-aware (GIGL vs merchant
    // "Store Pickup") via getPickupStationCopy.
    <fieldset className="m-0 mt-4 min-w-0 border-0 p-0 animate-in fade-in">
      <legend className="mb-3 text-xs font-bold uppercase tracking-wide text-store-background-text/70">
        {getPickupStationCopy(stationPickupQuote).detailHeading}
      </legend>
      <div className="space-y-3">
        {stationPickupQuotes.map((quote) => (
          <label
            key={quote.id}
            className={`flex items-start justify-between gap-3 p-4 rounded-xl border cursor-pointer hover:border-store-primary/60 transition-all focus-within:ring-2 focus-within:ring-store-primary focus-within:ring-offset-2 ${
              selectedQuoteId === quote.id
                ? 'border-store-primary bg-store-primary/5 ring-1 ring-store-primary'
                : 'border-store-background-text/10 bg-store-background'
            }`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <input
                type="radio"
                name="station_pickup_quote"
                checked={selectedQuoteId === quote.id}
                onChange={() => setSelectedQuoteId(quote.id)}
                className="mt-0.5 size-4 border-store-background-text/25 text-store-primary focus:ring-store-primary"
              />
              <div className="min-w-0">
                <span className="text-sm font-bold text-store-background-text">
                  {quote.displayName}
                </span>
                <p className="mt-0.5 text-xs text-store-background-text/65">
                  {quote.stationAddress ||
                    getPickupStationCopy(quote).detailFallback}
                </p>
                {quote.stationInstructions && (
                  <p className="mt-1 text-xs text-store-background-text/55">
                    {quote.stationInstructions}
                  </p>
                )}
              </div>
            </div>
            <span className="shrink-0 text-sm font-bold text-store-background-text">
              {formatAmountInCurrency(
                quote.price,
                quote.currency,
                AUTO_FRACTION_OPTIONS
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  ) : (
    <div className="mt-4 rounded-xl border border-store-background-text/10 bg-store-background p-4 text-sm text-store-background-text/65">
      No nearby GIG Logistics pickup station is available for this address yet.
    </div>
  );
}

import { Building2, Store, Truck } from 'lucide-react';
import { AUTO_FRACTION_OPTIONS } from '@/lib/currency';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';
import { SmartQuoteLoader } from '../../../components/SmartQuoteLoader';
import type { ShippingQuote } from '../types';
import {
  getDeliveryEstimateLabel,
  getPickupStationCopy,
  getStationPickupAddressText,
  isMerchantQuote,
} from '../utils';

interface DoorDeliveryQuoteOptionsProps {
  isLoadingQuotes: boolean;
  doorDeliveryQuotes: ShippingQuote[];
  stationPickupQuote: ShippingQuote | undefined;
  selectedQuoteId: string;
  onSelectQuote: (quoteId: string) => void;
  onSelectStationPickup: (quoteId: string) => void;
  onRefreshRates: () => void;
}

/** Quote rows determine the height, keeping the next checkout action adjacent. */
export function DoorDeliveryQuoteOptions({
  isLoadingQuotes,
  doorDeliveryQuotes,
  stationPickupQuote,
  selectedQuoteId,
  onSelectQuote,
  onSelectStationPickup,
  onRefreshRates,
}: DoorDeliveryQuoteOptionsProps) {
  return (
    <div className="mt-6 border-t border-store-background-text/10 pt-4">
      <label className="block text-xs font-bold text-store-background-text/80 uppercase tracking-wide mb-3">
        Select Delivery Option
      </label>

      <div className="space-y-3">
        {isLoadingQuotes ? (
          <SmartQuoteLoader />
        ) : doorDeliveryQuotes.length > 0 ? (
          <div className="space-y-3">
            {doorDeliveryQuotes.map((quote) => (
              <label
                key={quote.id}
                className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer hover:border-store-primary/60 transition-all focus-within:ring-2 focus-within:ring-store-primary focus-within:ring-offset-2 ${
                  selectedQuoteId === quote.id
                    ? 'border-store-primary bg-store-primary/5 ring-1 ring-store-primary'
                    : 'border-store-background-text/10 bg-store-background'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="shipping_quote"
                    checked={selectedQuoteId === quote.id}
                    onChange={() => onSelectQuote(quote.id)}
                    className="size-4 text-store-primary focus:ring-store-primary border-store-background-text/25"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-store-background-text">
                        {quote.displayName}
                      </span>
                      {isMerchantQuote(quote) ? (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-store-primary/10 text-store-primary px-1.5 py-0.5 rounded font-bold">
                          <Store size={11} /> Store
                        </span>
                      ) : (
                        <>
                          {quote.carrierName.includes('GIG') && (
                            <span className="text-[10px] bg-store-background-text text-store-primary-text px-1.5 py-0.5 rounded font-bold">
                              GIGL
                            </span>
                          )}
                          {quote.carrierName.includes('Topship') && (
                            <span className="text-[10px] bg-store-primary text-store-primary-text px-1.5 py-0.5 rounded font-bold">
                              Best Value
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {getDeliveryEstimateLabel(quote) && (
                      <p className="text-xs text-store-background-text/60 mt-0.5">
                        Est. Delivery: {getDeliveryEstimateLabel(quote)}
                      </p>
                    )}
                  </div>
                </div>
                <span className="font-bold text-sm text-store-background-text">
                  {formatAmountInCurrency(
                    quote.price,
                    quote.currency,
                    AUTO_FRACTION_OPTIONS
                  )}
                </span>
              </label>
            ))}
          </div>
        ) : stationPickupQuote ? (
          <div className="rounded-xl border border-store-primary/20 bg-store-primary/5 p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
                <Building2 size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-store-background-text">
                  {
                    getPickupStationCopy(stationPickupQuote)
                      .doorUnavailableTitle
                  }
                </h4>
                <p className="mt-1 text-xs text-store-background-text/65">
                  {getPickupStationCopy(stationPickupQuote).doorUnavailableBody}
                </p>
                <p className="mt-3 text-xs font-medium text-store-background-text">
                  {getStationPickupAddressText(stationPickupQuote) ||
                    stationPickupQuote.displayName}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-bold text-store-background-text">
                    {formatAmountInCurrency(
                      stationPickupQuote.price,
                      stationPickupQuote.currency,
                      AUTO_FRACTION_OPTIONS
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectStationPickup(stationPickupQuote.id);
                    }}
                    className="inline-flex items-center justify-center rounded-full bg-store-primary px-4 py-2 text-xs font-bold text-store-primary-text transition-colors hover:bg-store-primary/90"
                  >
                    {getPickupStationCopy(stationPickupQuote).chooseButtonLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRefreshRates}
            className="w-full bg-linear-to-r from-store-primary/5 to-store-primary/10 border-2 border-dashed border-store-primary/30 rounded-xl p-5 flex flex-col items-center gap-3 hover:border-store-primary/50 hover:shadow-md transition-all group cursor-pointer"
          >
            <div className="size-12 bg-store-primary/10 rounded-full flex items-center justify-center text-store-primary group-hover:scale-110 transition-transform">
              <Truck size={24} />
            </div>
            <div className="text-center">
              <h4 className="text-sm font-bold text-store-background-text">
                🚚 Oops! Rates took a detour
              </h4>
              <p className="text-xs text-store-primary mt-1">
                Our delivery partners are a bit slow today. Tap here to try
                again!
              </p>
            </div>
            <span className="text-xs font-bold text-store-primary bg-store-primary/10 px-3 py-1 rounded-full group-hover:bg-store-primary/20 transition-colors">
              ↻ Refresh Rates
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

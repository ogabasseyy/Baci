'use client';

import { Check, Clock, Loader2, Package, Truck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';
import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import { cn } from '@/lib/utils';
import type { ShippingQuote } from '@/types/shipping-quote';
import { formatShippingDeliveryTime } from './shipping-options-delivery-time';
import { requestShippingOptions } from './shipping-options-quote-request';

interface QuoteItemPayload {
  name: string;
  quantity: number;
  weight: number;
  value: number;
}

interface ShippingOptionsProps {
  merchantId: string;
  receiverCity: string;
  receiverState: string;
  receiverAddress: string;
  receiverPhone: string;
  receiverName: string;
  cartItems: {
    name: string;
    quantity: number;
    price: number;
  }[];
  /** Canonical checkout subtotal, including assurance fees when selected. */
  cartSubtotal: number;
  onSelect: (quote: ShippingQuote | null, sessionId: string) => void;
  selectedQuoteId?: string;
  className?: string;
}

export function ShippingOptions({
  merchantId,
  receiverCity,
  receiverState,
  receiverAddress,
  receiverPhone,
  receiverName,
  cartItems,
  cartSubtotal,
  onSelect,
  selectedQuoteId,
  className,
}: ShippingOptionsProps) {
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use ref for onSelect to avoid re-fetching when it changes. The ref is
  // synced in an effect (never during render) so the compiler can memoize.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Mirror of the parent's selection for the stale-selection check below.
  const selectedQuoteIdRef = useRef(selectedQuoteId);
  useEffect(() => {
    selectedQuoteIdRef.current = selectedQuoteId;
  });

  // Track if we've already auto-selected
  const hasAutoSelected = useRef(false);

  // Serialize the request items so the fetch effect only re-runs when cart
  // content actually changes (not when the array identity changes).
  const serializedCartItems = JSON.stringify(
    cartItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      weight: 1, // Default weight 1kg per item
      value: item.price,
    }))
  );

  // Track if we've already fetched for current address
  const lastFetchKey = useRef<string>('');

  useEffect(() => {
    // Require minimum 2 characters for both city and state to avoid premature API calls
    if (
      !receiverCity ||
      !receiverState ||
      receiverCity.length < 2 ||
      receiverState.length < 2
    ) {
      return;
    }

    if (!merchantId) {
      return;
    }

    // Create a key for this specific fetch request
    const fetchKey = `${merchantId}-${receiverCity}-${receiverState}-${receiverAddress}-${cartSubtotal}-${serializedCartItems}`;

    // Skip if we've already fetched for this exact configuration
    if (lastFetchKey.current === fetchKey && quotes.length > 0) {
      return;
    }

    const fetchQuotes = () => {
      setIsLoading(true);
      setError(null);
      lastFetchKey.current = fetchKey;
      // A new destination needs a new selection: re-select from the fresh
      // response instead of keeping a quote (and shipping_rate_id) that was
      // verified against the previous address.
      hasAutoSelected.current = false;
      const hadSelection = selectedQuoteIdRef.current !== undefined;

      const quoteItems = JSON.parse(serializedCartItems) as QuoteItemPayload[];
      requestShippingOptions({
        merchantId,
        receiverCity,
        receiverState,
        receiverAddress,
        receiverPhone,
        receiverName,
        quoteItems,
        cartSubtotal,
      })
        .then((response) => {
          const normalized = normalizeShippingQuoteResponse(response);
          setQuotes(normalized.quotes);
          setSessionId(normalized.sessionId);

          if (normalized.warnings.length > 0) {
            console.warn('Shipping quote warnings:', normalized.warnings);
          }

          // Auto-select cheapest from each fresh response so the parent
          // never keeps a quote verified against a previous address.
          if (!hasAutoSelected.current && normalized.quotes.length > 0) {
            const cheapest = normalized.quotes.reduce((min, q) =>
              q.price < min.price ? q : min
            );
            onSelectRef.current(cheapest, normalized.sessionId);
            hasAutoSelected.current = true;
          } else if (normalized.quotes.length === 0 && hadSelection) {
            // The fresh response has nothing selectable: clear the parent's
            // stale selection instead of submitting it against the new address.
            onSelectRef.current(null, normalized.sessionId);
          }
        })
        .catch((err: unknown) => {
          console.error('Failed to fetch shipping quotes:', err);
          setError('Unable to get shipping options. Please try again.');
        })
        .finally(() => {
          setIsLoading(false);
        });
    };

    // Longer debounce to wait for user to finish typing
    const timer = setTimeout(fetchQuotes, 1000);
    return () => clearTimeout(timer);
  }, [
    receiverCity,
    receiverState,
    receiverAddress,
    receiverName,
    receiverPhone,
    serializedCartItems,
    cartSubtotal,
    quotes.length,
    merchantId,
  ]);

  const getProviderLogo = (provider: string) => {
    switch (provider) {
      case 'GIGL':
        return 'GIG';
      case 'TOPSHIP':
        return 'TS';

      default:
        return provider.slice(0, 2);
    }
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="size-6 animate-spin text-muted-foreground mr-2" />
        <span className="text-muted-foreground">
          Finding best shipping options…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'p-4 bg-destructive/10 text-destructive rounded-lg',
          className
        )}
      >
        {error}
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div
        className={cn(
          'p-4 bg-muted text-muted-foreground rounded-lg text-center',
          className
        )}
      >
        <Package className="size-8 mx-auto mb-2 opacity-50" />
        <p>Enter your address to see shipping options</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <h4 className="font-medium text-sm text-muted-foreground">
        Select Shipping Option
      </h4>
      {quotes.map((quote) => (
        <Card
          key={quote.id}
          role="button"
          tabIndex={0}
          className={cn(
            'cursor-pointer transition-all border-2',
            selectedQuoteId === quote.id
              ? 'border-primary bg-primary/5'
              : 'border-transparent hover:border-muted-foreground/20'
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(quote, sessionId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onSelect(quote, sessionId);
            }
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Carrier or merchant delivery provider badge. */}
                <div className="size-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
                  {getProviderLogo(quote.provider)}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{quote.carrierName}</p>
                    {selectedQuoteId === quote.id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatShippingDeliveryTime(quote)}
                    </span>
                    {quote.isStationPickup && (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                        Station Pickup
                      </span>
                    )}
                    {quote.insuranceIncluded && (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        Insured
                      </span>
                    )}
                  </div>
                  {quote.isStationPickup && quote.stationName && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Pickup: {quote.stationName}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="font-bold text-lg">
                  {formatAmountInCurrency(quote.price, quote.currency)}
                </p>
                {quote.pickupIncluded && (
                  <p className="text-xs text-green-600">Free pickup</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Simple shipping display for Step 2 (payment confirmation)
 */
export function SelectedShippingDisplay({
  quote,
  className,
}: {
  quote: ShippingQuote | null;
  className?: string;
}) {
  if (!quote) {
    return (
      <Card className={className}>
        <CardContent className="p-4 flex items-center gap-4">
          <Truck className="size-6 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-semibold text-muted-foreground">
              No shipping selected
            </p>
            <p className="text-sm text-muted-foreground">
              Go back to select shipping
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const deliveryTime = formatShippingDeliveryTime(quote);

  return (
    <Card className={className}>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Truck className="size-6 text-muted-foreground" />
          <div>
            <p className="font-semibold">{quote.carrierName}</p>
            <p className="text-sm text-muted-foreground">
              {deliveryTime === 'ETA unavailable'
                ? deliveryTime
                : `Est. ${deliveryTime}`}
              {quote.isStationPickup && ' (Station Pickup)'}
            </p>
          </div>
        </div>
        <p className="font-semibold">
          {formatAmountInCurrency(quote.price, quote.currency)}
        </p>
      </CardContent>
    </Card>
  );
}

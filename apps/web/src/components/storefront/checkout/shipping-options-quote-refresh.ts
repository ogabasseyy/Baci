import { useEffect, useRef, useState } from 'react';
import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import type { ShippingQuote } from '@/types/shipping-quote';
import { requestShippingOptions } from './shipping-options-quote-request';

interface QuoteItemPayload {
  name: string;
  quantity: number;
  weight: number;
  value: number;
}

interface UseShippingQuoteRefreshParams {
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
}

/**
 * Fetches shipping quotes for the current destination and keeps the parent's
 * selection in sync: auto-selects the cheapest quote from each fresh
 * response, and clears the parent selection when the fresh response is empty
 * or the refresh fails, so a quote verified against a previous
 * address/subtotal is never submitted.
 */
export function useShippingQuoteRefresh({
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
}: UseShippingQuoteRefreshParams) {
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
          if (hadSelection) {
            // The refresh failed: the previous selection was verified
            // against an older address/subtotal, so drop it instead of
            // submitting it against the new request.
            onSelectRef.current(null, '');
          }
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

  return { quotes, sessionId, isLoading, error };
}

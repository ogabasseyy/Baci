import { useRef, useState } from 'react';
import {
  calculateRepairShipping,
  type ShippingCalculationResult,
} from '@/app/actions/repair';
import type { PlaceDetails } from '@/components/address-autocomplete';

export function useRepairShippingQuote(merchantSlug: string) {
  const requestId = useRef(0);
  const selectedPlace = useRef<PlaceDetails | null>(null);
  const [shippingQuote, setShippingQuote] =
    useState<ShippingCalculationResult | null>(null);
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false);

  const calculate = async (place: PlaceDetails) => {
    const currentRequestId = ++requestId.current;
    setIsCalculatingShipping(true);
    setShippingQuote(null);
    try {
      const quote = await calculateRepairShipping(place, merchantSlug);
      if (currentRequestId === requestId.current) setShippingQuote(quote);
    } catch {
      if (currentRequestId === requestId.current) {
        setShippingQuote({
          error: 'We could not calculate the pickup fee. Please try again.',
          formattedPrice: 'Pickup fee unavailable',
          isFree: false,
          price: 0,
        });
      }
    } finally {
      if (currentRequestId === requestId.current) {
        setIsCalculatingShipping(false);
      }
    }
  };

  const selectAddress = (place: PlaceDetails) => {
    selectedPlace.current = place;
    return calculate(place);
  };

  const retry = () => {
    if (selectedPlace.current) {
      return calculate(selectedPlace.current);
    }
    return Promise.resolve();
  };

  const applyShippingQuote = (quote: ShippingCalculationResult) => {
    setShippingQuote(quote);
  };

  return {
    applyShippingQuote,
    isCalculatingShipping,
    retry,
    selectAddress,
    shippingQuote,
  };
}

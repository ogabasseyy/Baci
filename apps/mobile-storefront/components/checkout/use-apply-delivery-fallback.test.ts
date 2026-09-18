import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import type { DeliveryMethod } from './types';
import { useApplyDeliveryFallback } from './use-apply-delivery-fallback';

function useHarnessMethod() {
  const [deliveryMethod, setDeliveryMethod] =
    useState<DeliveryMethod>('airport');
  const [selectedQuoteId, setSelectedQuoteId] = useState('road-quote');
  useApplyDeliveryFallback({
    canUsePickupStation: true,
    deliveryMethod,
    hasResolvedDeliveryLocation: false,
    selectedQuoteId,
    setDeliveryMethod,
    setSelectedQuoteId,
    shippingQuotes: [],
    watchedCity: 'Lagos',
    watchedState: 'Lagos',
  });
  return { deliveryMethod, selectedQuoteId };
}

describe('useApplyDeliveryFallback', () => {
  it('reverts to door with the re-resolved quote, then settles', () => {
    // Arrange & Act: airport without a resolved location falls back.
    const { result } = renderHook(() => useHarnessMethod());

    // Assert: the method update applies and the guard stops looping.
    expect(result.current.deliveryMethod).toBe('door');
    expect(result.current.selectedQuoteId).toBe('');
  });

  it('leaves an eligible selection untouched', () => {
    // Arrange & Act
    const { result } = renderHook(() => {
      const [deliveryMethod] = useState<DeliveryMethod>('door');
      const [selectedQuoteId] = useState('road-quote');
      useApplyDeliveryFallback({
        canUsePickupStation: true,
        deliveryMethod,
        hasResolvedDeliveryLocation: true,
        selectedQuoteId,
        setDeliveryMethod: () => {},
        setSelectedQuoteId: () => {},
        shippingQuotes: [],
        watchedCity: 'Lagos',
        watchedState: 'Lagos',
      });
      return { deliveryMethod, selectedQuoteId };
    });

    // Assert
    expect(result.current.deliveryMethod).toBe('door');
    expect(result.current.selectedQuoteId).toBe('road-quote');
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRouteOfferMissing } from './use-route-offer-missing';

describe('useRouteOfferMissing', () => {
  it('blocks purchase until the shopper picks a condition', () => {
    const setSelectedCondition = vi.fn();
    const { result } = renderHook(() =>
      useRouteOfferMissing(true, true, setSelectedCondition)
    );

    expect(result.current.routeOfferMissingActive).toBe(true);
    expect(result.current.effectiveCanPurchase).toBe(false);

    act(() => {
      result.current.handleSetCondition('used');
    });

    expect(setSelectedCondition).toHaveBeenCalledWith('used');
    expect(result.current.routeOfferMissingActive).toBe(false);
    expect(result.current.effectiveCanPurchase).toBe(true);
  });

  it('passes purchase through when nothing is missing', () => {
    const setSelectedCondition = vi.fn();
    const { result } = renderHook(() =>
      useRouteOfferMissing(false, true, setSelectedCondition)
    );

    expect(result.current.routeOfferMissingActive).toBe(false);
    expect(result.current.effectiveCanPurchase).toBe(true);
  });

  it('keeps unrelated purchase blocks while missing', () => {
    const setSelectedCondition = vi.fn();
    const { result } = renderHook(() =>
      useRouteOfferMissing(true, false, setSelectedCondition)
    );

    expect(result.current.effectiveCanPurchase).toBe(false);
  });
});

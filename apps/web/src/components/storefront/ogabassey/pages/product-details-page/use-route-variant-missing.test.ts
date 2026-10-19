import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRouteVariantMissing } from './use-route-variant-missing';

describe('useRouteVariantMissing', () => {
  it('blocks purchase until the shopper picks attributes', () => {
    const setSelectedAttributes = vi.fn();
    const { result } = renderHook(() =>
      useRouteVariantMissing(true, true, setSelectedAttributes)
    );

    expect(result.current.routeVariantMissingActive).toBe(true);
    expect(result.current.effectiveCanPurchase).toBe(false);

    act(() => {
      result.current.handleSetAttributes({ color: 'Red' });
    });

    expect(setSelectedAttributes).toHaveBeenCalledWith({ color: 'Red' });
    expect(result.current.routeVariantMissingActive).toBe(false);
    expect(result.current.effectiveCanPurchase).toBe(true);
  });

  it('passes purchase through when nothing is missing', () => {
    const setSelectedAttributes = vi.fn();
    const { result } = renderHook(() =>
      useRouteVariantMissing(false, true, setSelectedAttributes)
    );

    expect(result.current.routeVariantMissingActive).toBe(false);
    expect(result.current.effectiveCanPurchase).toBe(true);
  });

  it('keeps unrelated purchase blocks while missing', () => {
    const setSelectedAttributes = vi.fn();
    const { result } = renderHook(() =>
      useRouteVariantMissing(true, false, setSelectedAttributes)
    );

    expect(result.current.effectiveCanPurchase).toBe(false);
  });
});

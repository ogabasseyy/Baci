import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { useRouteSelectionMissing } from './use-route-selection-missing';

const product = {
  id: 'product-1',
  offers: [
    { id: 'offer-live', condition: 'used' },
    { id: 'offer-new', condition: 'new' },
  ],
  variants: [{ id: 'variant-live' }],
} as unknown as Product;

function renderMissingHook(
  overrides: {
    offerIdParam?: string | null;
    routeSeedKey?: string;
    routeVariantId?: string | null;
  } = {}
) {
  return renderHook(() =>
    useRouteSelectionMissing({
      offerIdParam: overrides.offerIdParam ?? null,
      product,
      routeSeedKey: overrides.routeSeedKey ?? 'product-1|simple',
      routeVariantId: overrides.routeVariantId ?? null,
    })
  );
}

describe('useRouteSelectionMissing', () => {
  it('honors a live route offer id', () => {
    const { result } = renderMissingHook({ offerIdParam: 'offer-live' });

    expect(result.current.routeOfferId).toBe('offer-live');
    expect(result.current.routeOfferMissing).toBe(false);
  });

  it('flags a dead route offer id as missing', () => {
    const { result } = renderMissingHook({ offerIdParam: 'offer-gone' });

    expect(result.current.routeOfferId).toBeNull();
    expect(result.current.routeOfferMissing).toBe(true);
  });

  it('clears missing once the shopper explicitly picks past the dead id', () => {
    const { result } = renderMissingHook({ offerIdParam: 'offer-gone' });

    act(() => {
      result.current.setIgnoredRouteOfferId('offer-gone');
    });

    expect(result.current.routeOfferMissing).toBe(false);
  });

  it('flags a dead route variant id as missing', () => {
    const { result } = renderMissingHook({ routeVariantId: 'variant-gone' });

    expect(result.current.routeVariantMissing).toBe(true);
  });

  it('reseeds ignores when the route seed key changes', () => {
    const { result, rerender } = renderHook(
      ({ seedKey }: { seedKey: string }) =>
        useRouteSelectionMissing({
          offerIdParam: 'offer-gone',
          product,
          routeSeedKey: seedKey,
          routeVariantId: null,
        }),
      { initialProps: { seedKey: 'product-1|simple|offer-gone' } }
    );

    act(() => {
      result.current.setIgnoredRouteOfferId('offer-gone');
    });
    expect(result.current.routeOfferMissing).toBe(false);

    rerender({ seedKey: 'product-1|simple|offer-also-gone' });

    expect(result.current.routeOfferMissing).toBe(true);
  });
});

import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useEffectivePrice } from '@/hooks/use-effective-price';
import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import type { Product } from '@/types/product';
import { useProductDetailPurchaseState } from './use-product-detail-purchase-state';
import type { useProductDetailRouteData } from './use-product-detail-route-data';

jest.mock('@/hooks/use-effective-price', () => ({
  useEffectivePrice: jest.fn(() => ({ price: 100, comparePrice: undefined })),
}));
jest.mock('@/lib/product-condition-offers', () => ({
  findMatchingConditionOffer: jest.fn(() => null),
}));
jest.mock('@/services/tiktok-product-route-tracking', () => ({
  useTrackProductRouteViewed: jest.fn(),
}));

const mockUseEffectivePrice = useEffectivePrice as jest.MockedFunction<
  typeof useEffectivePrice
>;
const mockFindMatchingConditionOffer =
  findMatchingConditionOffer as jest.MockedFunction<
    typeof findMatchingConditionOffer
  >;

type RouteData = ReturnType<typeof useProductDetailRouteData>;

function routeData(overrides: Partial<RouteData> = {}): RouteData {
  return {
    product: { id: 'p1', price: 100 } as Product,
    currentVariantDisplaySelection: null,
    currentVariantSelection: null,
    effectiveSelectedCondition: null,
    offerConditionKey: 'used',
    routeOfferId: null,
    suppressConditionOfferMatch: false,
    usesVariantConditions: false,
    ...overrides,
  } as RouteData;
}

beforeEach(() => {
  mockUseEffectivePrice.mockClear();
  mockFindMatchingConditionOffer.mockClear();
});

it('forwards an exact offer id into price resolution and offer selection', () => {
  renderHook(() =>
    useProductDetailPurchaseState(
      routeData({ routeOfferId: 'offer-9' }),
      0,
      null
    )
  );

  expect(mockUseEffectivePrice).toHaveBeenCalledTimes(2);
  for (const call of mockUseEffectivePrice.mock.calls) {
    expect(call[4]).toBe('offer-9');
    expect(call[5]).toBe(false);
  }
  expect(mockFindMatchingConditionOffer).toHaveBeenCalledWith(
    undefined,
    'used',
    'offer-9',
    false
  );
});

it('forwards ID-less base-match suppression instead of an offer id', () => {
  renderHook(() =>
    useProductDetailPurchaseState(
      routeData({ routeOfferId: null, suppressConditionOfferMatch: true }),
      0,
      null
    )
  );

  expect(mockUseEffectivePrice).toHaveBeenCalledTimes(2);
  for (const call of mockUseEffectivePrice.mock.calls) {
    expect(call[4]).toBeNull();
    expect(call[5]).toBe(true);
  }
  expect(mockFindMatchingConditionOffer).toHaveBeenCalledWith(
    undefined,
    'used',
    null,
    true
  );
});

it('skips offer matching for variant products but keeps price forwarding', () => {
  renderHook(() =>
    useProductDetailPurchaseState(
      routeData({
        product: { id: 'p1', price: 100, has_variants: true } as Product,
        routeOfferId: 'offer-9',
      }),
      0,
      null
    )
  );

  expect(mockFindMatchingConditionOffer).not.toHaveBeenCalled();
  expect(mockUseEffectivePrice).toHaveBeenCalledTimes(2);
  for (const call of mockUseEffectivePrice.mock.calls) {
    expect(call[4]).toBe('offer-9');
  }
});

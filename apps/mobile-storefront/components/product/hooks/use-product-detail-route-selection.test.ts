import { act, renderHook } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};
let mockStaging = false;
let mockReviewProductId: string | undefined;
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));
jest.mock('@/hooks/use-reviews', () => ({
  useReviews: ({ productId }: { productId: string }) => {
    mockReviewProductId = productId;
    return {};
  },
}));
jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: () => (mockStaging ? {} : null),
}));
jest.mock('@/lib/product-variant-metadata', () => ({
  resolveProductVariantMetadata: () => ({}),
}));

import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import type { Product } from '@/types/product';
import { useProductDetailRouteData } from './use-product-detail-route-data';

const product = {
  id: 'p1',
  slug: 'phone',
  name: 'Phone',
  price: 100,
  condition: 'new',
  has_variants: false,
  has_condition_offers: true,
  offers: [
    { id: 'o1', condition: 'used', price: 80 },
    { id: 'o2', condition: 'open_box', price: 90 },
  ],
} as unknown as Product;

function setup(params: Record<string, string>) {
  mockParams = params;
  return renderHook(() =>
    useProductDetailRouteData({
      product,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStaging = false;
  mockReviewProductId = undefined;
});

it('ignores the variant hydration marker without an exact variant link', () => {
  mockParams = { slug: 'phone' };
  const marked = {
    ...product,
    has_variants: true,
    variants: undefined,
    variants_hydration_failed: true,
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: marked,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeVariantHydrationFailed).toBe(false);
  expect(result.current.error).toBeNull();
});

it('fails closed when the base-inventory projection fetch failed', () => {
  mockParams = { slug: 'phone' };
  const marked = {
    ...product,
    has_variants: false,
    base_inventory_hydration_failed: true,
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: marked,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  // Without the projection the PDP cannot tell "no units" from
  // "unknown units": surface retry instead of a confident OOS.
  expect(result.current.routeBaseInventoryHydrationFailed).toBe(true);
  expect(result.current.error).toMatch(/Availability could not be loaded/);
});

it('honors an ID-only offer through the synced selection on product load', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  const { result, rerender } = renderHook(
    ({ loaded }: { loaded: boolean }) =>
      useProductDetailRouteData({
        product: loaded ? product : null,
        isLoading: !loaded,
        error: null,
        refetch: jest.fn(),
      } as never),
    { initialProps: { loaded: false } }
  );

  // The committed selection syncs the live offer condition during render,
  // so the honor path resolves the identified offer — never a same-
  // condition fallthrough and never null on first paint with data.
  rerender({ loaded: true });
  expect(result.current.routeOfferId).toBe('o1');
  expect(result.current.offerConditionKey).toBe('used');
  expect(
    findMatchingConditionOffer(
      product.offers,
      result.current.offerConditionKey,
      result.current.routeOfferId
    )?.id
  ).toBe('o1');
});

it('suppresses offer resolution for base-row entries until a PDP pick', () => {
  const { result } = setup({
    slug: 'phone',
    condition: 'used',
    match_base: '1',
  });

  expect(result.current.suppressConditionOfferMatch).toBe(true);

  // A shopper-picked condition is an explicit selection again.
  act(() => {
    result.current.setSelectedCondition('open_box');
  });
  expect(result.current.suppressConditionOfferMatch).toBe(false);
});

it('does not suppress offer resolution without the base identity', () => {
  const { result } = setup({ slug: 'phone', condition: 'used' });

  expect(result.current.suppressConditionOfferMatch).toBe(false);
});

it('does not suppress base rows when an explicit offer id is present', () => {
  const { result } = setup({
    slug: 'phone',
    offer_id: 'o1',
    condition: 'used',
    match_base: '1',
  });

  expect(result.current.suppressConditionOfferMatch).toBe(false);
});

it('treats a bare match_base flag as keep-base-price', () => {
  // A match object with neither ids nor condition still carries the base
  // identity: the PDP must not resolve a same-condition offer for it.
  const { result } = setup({ slug: 'phone', match_base: '1' });

  expect(result.current.suppressConditionOfferMatch).toBe(true);

  // Any explicit PDP pick re-enables offer resolution, even from bare.
  act(() => {
    result.current.setHasCustomizedSelection(true);
    result.current.setSelectedCondition('used');
  });
  expect(result.current.suppressConditionOfferMatch).toBe(false);
});

it('fails closed when an exact variant id names no live variant', () => {
  mockParams = { slug: 'phone', variant_id: 'gone' };
  const variantProduct = {
    ...product,
    has_variants: true,
    variants: [{ id: 'v1', attributes: {} }],
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: variantProduct,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  // The advertised variant was deleted while siblings remain: surface
  // the unavailable path instead of redirecting to the bare URL, where
  // the PDP would silently select a different price/specification.
  expect(result.current.routeVariantMissing).toBe(true);
  expect(result.current.error).toMatch(/no longer available/);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('keeps live exact variants out of the missing path', () => {
  mockParams = { slug: 'phone', variant_id: 'v1' };
  const variantProduct = {
    ...product,
    has_variants: true,
    variants: [{ id: 'v1', attributes: {} }],
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: variantProduct,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeVariantMissing).toBe(false);
  expect(result.current.error).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('preserves the saved selection when canonicalizing a legacy slug', () => {
  setup({
    slug: 'legacy-phone',
    offer_id: 'o1',
    condition: 'used',
    match_base: '1',
  });

  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/product/[slug]',
    params: {
      slug: 'phone',
      offer_id: 'o1',
      condition: 'used',
      match_base: '1',
    },
  });
});

it('skips unsupported reviews only in the isolated Oxygen staging profile', () => {
  mockStaging = true;
  setup({ slug: 'phone' });
  expect(mockReviewProductId).toBe('');
  mockStaging = false;
  setup({ slug: 'phone' });
  expect(mockReviewProductId).toBe('p1');
});

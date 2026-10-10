import { act, renderHook } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));
jest.mock('@/hooks/use-reviews', () => ({
  useReviews: () => ({}),
}));
let mockCapturedRouteCondition: unknown;
jest.mock('./use-product-detail-selection', () => {
  const actual = jest.requireActual('./use-product-detail-selection');
  return {
    useProductDetailSelection: (args: {
      routeCondition: unknown;
      product: unknown;
    }) => {
      mockCapturedRouteCondition = args.routeCondition;
      return actual.useProductDetailSelection(args);
    },
  };
});
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
  mockCapturedRouteCondition = undefined;
});

it('derives the route condition from the live offer on ID-only links', () => {
  const { result } = setup({ slug: 'phone', offer_id: 'o1' });

  expect(mockCapturedRouteCondition).toBe('used');
  expect(result.current.routeOfferId).toBe('o1');
});

it('keeps an explicit condition authoritative over the live offer', () => {
  setup({ slug: 'phone', offer_id: 'o1', condition: 'new' });

  expect(mockCapturedRouteCondition).toBe('new');
});

it('fails closed when the offer id is absent from hydrated offers', () => {
  const { result } = setup({ slug: 'phone', offer_id: 'nope' });

  // The offers array hydrated successfully, so a missing id means the offer
  // is gone (removed/sold) — not a transient fetch failure. Do not fall back
  // to the parent default's price; surface the unavailable path instead.
  expect(mockCapturedRouteCondition).toBeNull();
  expect(result.current.routeOfferId).toBeNull();
  expect(result.current.routeOfferHydrationFailed).toBe(false);
  expect(result.current.error).toMatch(/no longer available/);
});

it('fails closed when an exact offer link meets a hydration failure', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  const marked = {
    ...product,
    offers: undefined,
    offers_hydration_failed: true,
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: marked,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  // The requested identity must not silently degrade to the parent: the
  // screen shows its retry/unavailable path instead.
  expect(result.current.routeOfferHydrationFailed).toBe(true);
  expect(result.current.routeOfferId).toBeNull();
  expect(result.current.error).toMatch(/could not be loaded/);
});

it('ignores the hydration marker without an exact offer link', () => {
  mockParams = { slug: 'phone' };
  const marked = {
    ...product,
    offers: undefined,
    offers_hydration_failed: true,
  };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: marked,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferHydrationFailed).toBe(false);
  expect(result.current.error).toBeNull();
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

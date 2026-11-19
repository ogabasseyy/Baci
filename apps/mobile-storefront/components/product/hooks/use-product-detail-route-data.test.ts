import { renderHook } from '@testing-library/react-native';

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
jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: () => null,
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

it('marks an exact offer link pending while cached rows omit offers', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  // Cache-seeded rows omit `offers` until the detail refetch lands: not
  // failed, not yet an array. Neither missing nor failed fires, so the
  // pending flag is what blocks the parent-price purchase path.
  const cached = { ...product, offers: undefined };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: cached,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferHydrationPending).toBe(true);
  expect(result.current.routeOfferId).toBeNull();
  expect(result.current.routeOfferHydrationFailed).toBe(false);
  expect(result.current.error).toBeNull();
});

it('clears the pending flag once offers hydrate', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferHydrationPending).toBe(false);
  expect(result.current.routeOfferId).toBe('o1');
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

it('rejects a stale offer id when the live hydration failed', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  // A failed offer fetch preserves the row's prior offers array: the id
  // still matches, but the identity is stale and must not be accepted.
  const stale = { ...product, offers_hydration_failed: true };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: stale,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferId).toBeNull();
  expect(result.current.routeOfferHydrationFailed).toBe(true);
  expect(result.current.error).toMatch(/could not be loaded/);
});

it('rejects an offer id on a product that never carried offers', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  const offerless = { ...product, has_condition_offers: false };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: offerless,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferId).toBeNull();
});

it('reports unavailable and seeds no condition from a stale row on a flag-disabled parent', () => {
  mockParams = { slug: 'phone', offer_id: 'o1' };
  // The fixture offers array still carries o1 (stale hydration after
  // the merchant turned the flag off): the row must be invisible.
  const flagOff = { ...product, has_condition_offers: false };
  const { result } = renderHook(() =>
    useProductDetailRouteData({
      product: flagOff,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never)
  );

  expect(result.current.routeOfferId).toBeNull();
  expect(result.current.error).toMatch(/no longer available/);
  // Pricing, selection, and add all resolve through
  // findMatchingConditionOffer: suppressing the match keeps the stale
  // row out of the stamped offer_id so checkout never sees it.
  expect(result.current.suppressConditionOfferMatch).toBe(true);
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

it('fails closed when an exact variant link meets a hydration failure', () => {
  mockParams = { slug: 'phone', variant_id: 'v1' };
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

  // Without variants the selection resolution is null, so the missing
  // predicate stays silent — the hydration marker must surface retry
  // instead of rendering a normal PDP.
  expect(result.current.routeVariantHydrationFailed).toBe(true);
  expect(result.current.routeVariantMissing).toBe(false);
  expect(result.current.error).toMatch(/could not be loaded/);
});

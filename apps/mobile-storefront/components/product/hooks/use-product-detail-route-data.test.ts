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

it('clears the route condition when the offer id names no live offer', () => {
  const { result } = setup({ slug: 'phone', offer_id: 'nope' });

  expect(mockCapturedRouteCondition).toBeNull();
  expect(result.current.routeOfferId).toBeNull();
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

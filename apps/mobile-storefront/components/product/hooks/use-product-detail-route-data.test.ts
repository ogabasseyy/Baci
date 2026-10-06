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
let capturedRouteCondition: unknown;
jest.mock('./use-product-detail-selection', () => ({
  useProductDetailSelection: (args: { routeCondition: unknown }) => {
    capturedRouteCondition = args.routeCondition;
    return {
      selectedImageIndex: 0,
      setSelectedImageIndex: jest.fn(),
      effectiveSelectedCondition: null,
    };
  },
}));
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
  capturedRouteCondition = undefined;
});

it('derives the route condition from the live offer on ID-only links', () => {
  const { result } = setup({ slug: 'phone', offer_id: 'o1' });

  expect(capturedRouteCondition).toBe('used');
  expect(result.current.routeOfferId).toBe('o1');
});

it('keeps an explicit condition authoritative over the live offer', () => {
  setup({ slug: 'phone', offer_id: 'o1', condition: 'new' });

  expect(capturedRouteCondition).toBe('new');
});

it('clears the route condition when the offer id names no live offer', () => {
  const { result } = setup({ slug: 'phone', offer_id: 'nope' });

  expect(capturedRouteCondition).toBeNull();
  expect(result.current.routeOfferId).toBeNull();
});

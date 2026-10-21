import { renderHook, waitFor } from '@testing-library/react-native';
import type { CartPriceChange } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';

const mockRepriceCartItems = jest.fn();
const mockRepriceItems = jest.fn();
let mockMerchant: { id: string } | null = { id: 'merchant-1' };
let mockIsFocused = true;
let mockItems: CartItem[] = [];

jest.mock('@/components/checkout/checkout-screen.constants', () => ({
  CHECKOUT_MERCHANT_ID: 'fallback-merchant',
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => ({ data: mockMerchant }),
}));

jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
}));

jest.mock('@/services/cart-reprice', () => ({
  repriceCartItems: (
    items: CartItem[],
    merchantId: string
  ): Promise<{
    priceById: Record<string, number>;
    changes: CartPriceChange[];
  }> => mockRepriceCartItems(items, merchantId),
  pickChangedPriceById: (result: {
    changes: { id: string }[];
    priceById: Record<string, number>;
  }) => {
    const out: Record<string, number> = {};
    for (const change of result.changes) {
      const live = result.priceById[change.id];
      if (typeof live === 'number') out[change.id] = live;
    }
    return out;
  },
  pickChangedConditionById: (result: {
    changes: { id: string }[];
    conditionChanges?: { id: string }[];
    conditionById: Record<string, string>;
  }) => {
    const out: Record<string, string> = {};
    for (const change of [
      ...result.changes,
      ...(result.conditionChanges ?? []),
    ]) {
      const live = result.conditionById[change.id];
      if (typeof live === 'string') out[change.id] = live;
    }
    return out;
  },
  pickChangedOfferIdById: (result: {
    adoptions?: { id: string }[];
    offerIdById: Record<string, string>;
  }) => {
    const out: Record<string, string> = {};
    for (const adoption of result.adoptions ?? []) {
      const live = result.offerIdById[adoption.id];
      if (typeof live === 'string') out[adoption.id] = live;
    }
    return out;
  },
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: jest.fn(),
}));

const mockedUseCartStore = (
  jest.requireMock('@/stores/cart-store') as {
    useCartStore: jest.Mock;
  }
).useCartStore;

let useCartReprice: typeof import('./use-cart-reprice').useCartReprice;

beforeAll(async () => {
  ({ useCartReprice } = await import('./use-cart-reprice'));
});

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-1',
    product_id: 'product-1',
    slug: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    price: 1200000,
    quantity: 1,
    ...overrides,
  };
}

describe('checkout fencing during repricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMerchant = { id: 'merchant-1' };
    mockIsFocused = true;
    mockItems = [createItem()];
    mockedUseCartStore.mockImplementation(
      (
        selector: (state: {
          items: CartItem[];
          repriceItems: typeof mockRepriceItems;
        }) => unknown
      ) => selector({ items: mockItems, repriceItems: mockRepriceItems })
    );
  });

  it('fences checkout when repricing reports only unavailable lines', async () => {
    const { sharedCartWriteRevision } = await import(
      '@/stores/shared-cart-writer'
    );
    mockItems = [createItem({ id: 'line-1' })];
    mockRepriceCartItems.mockResolvedValue({
      priceById: {},
      changes: [],
      conditionChanges: [],
      conditionById: {},
      adoptions: [],
      offerIdById: {},
      unavailable: [{ id: 'line-1' }],
    });
    const before = sharedCartWriteRevision();
    const { result } = renderHook(() => useCartReprice());
    await waitFor(() =>
      expect(result.current.unavailableLines).toHaveLength(1)
    );
    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(sharedCartWriteRevision()).toBe(before + 1);
  });
});

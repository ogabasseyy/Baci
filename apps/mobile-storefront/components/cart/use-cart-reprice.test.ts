import { act, renderHook, waitFor } from '@testing-library/react-native';
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
    conditionById: Record<string, string>;
  }) => {
    const out: Record<string, string> = {};
    for (const change of result.changes) {
      const live = result.conditionById[change.id];
      if (typeof live === 'string') out[change.id] = live;
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

describe('useCartReprice', () => {
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

  it('reprices cart lines and exposes dismissible price changes', async () => {
    const changes: CartPriceChange[] = [
      {
        id: 'cart-1',
        name: 'iPhone 15 Pro',
        oldPrice: 1200000,
        newPrice: 1250000,
      },
    ];
    mockRepriceCartItems.mockResolvedValue({
      priceById: { 'cart-1': 1250000 },
      conditionById: {},
      changes,
    });

    const { result } = renderHook(() => useCartReprice());

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledWith(
        mockItems,
        'merchant-1'
      );
      expect(mockRepriceItems).toHaveBeenCalledWith({ 'cart-1': 1250000 }, {});
      expect(result.current.priceChanges).toEqual(changes);
    });

    act(() => {
      result.current.dismissPriceChanges();
    });

    expect(result.current.priceChanges).toEqual([]);
  });

  it('uses the fallback merchant id when merchant data has not loaded', async () => {
    mockMerchant = null;
    mockRepriceCartItems.mockResolvedValue({
      priceById: {},
      changes: [],
    });

    renderHook(() => useCartReprice());

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledWith(
        mockItems,
        'fallback-merchant'
      );
    });
  });

  it('falls back when the merchant id is a blank placeholder string', async () => {
    // CONFIG.MERCHANT_ID defaults to '' and seeds the merchant placeholder, so
    // `??` would reprice against an empty id — `||` must fall back instead.
    mockMerchant = { id: '' };
    mockRepriceCartItems.mockResolvedValue({
      priceById: {},
      changes: [],
    });

    renderHook(() => useCartReprice());

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledWith(
        mockItems,
        'fallback-merchant'
      );
    });
  });

  it('skips repricing when the cart is empty', () => {
    mockItems = [];

    const { result } = renderHook(() => useCartReprice());

    expect(mockRepriceCartItems).not.toHaveBeenCalled();
    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(result.current.priceChanges).toEqual([]);
  });

  it('reprices after an empty cart becomes populated while focused', async () => {
    mockItems = [];
    mockRepriceCartItems.mockResolvedValue({
      priceById: {},
      changes: [],
    });

    const { rerender } = renderHook(() => useCartReprice());

    expect(mockRepriceCartItems).not.toHaveBeenCalled();

    mockItems = [createItem({ id: 'cart-2', product_id: 'product-2' })];
    rerender(undefined);

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledWith(
        mockItems,
        'merchant-1'
      );
    });
  });

  it('waits until the cart screen is focused before repricing', async () => {
    mockIsFocused = false;
    mockRepriceCartItems.mockResolvedValue({
      priceById: {},
      changes: [],
    });

    const { rerender } = renderHook(() => useCartReprice());

    expect(mockRepriceCartItems).not.toHaveBeenCalled();

    mockIsFocused = true;
    rerender(undefined);

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledWith(
        mockItems,
        'merchant-1'
      );
    });
  });

  it('fails open when repricing rejects after an empty cart becomes populated', async () => {
    mockItems = [];
    mockRepriceCartItems.mockRejectedValue(new Error('network unavailable'));

    const { result, rerender } = renderHook(() => useCartReprice());

    expect(mockRepriceCartItems).not.toHaveBeenCalled();

    mockItems = [createItem({ id: 'cart-2', product_id: 'product-2' })];
    rerender(undefined);

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(result.current.priceChanges).toEqual([]);
  });

  it('fails open when focus-gated repricing rejects', async () => {
    mockIsFocused = false;
    mockRepriceCartItems.mockRejectedValue(new Error('network unavailable'));

    const { result, rerender } = renderHook(() => useCartReprice());

    expect(mockRepriceCartItems).not.toHaveBeenCalled();

    mockIsFocused = true;
    rerender(undefined);

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(result.current.priceChanges).toEqual([]);
  });

  it('fails open without mutating cart state when repricing rejects', async () => {
    mockRepriceCartItems.mockRejectedValue(new Error('network unavailable'));

    const { result } = renderHook(() => useCartReprice());

    await waitFor(() => {
      expect(mockRepriceCartItems).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(result.current.priceChanges).toEqual([]);
  });
});

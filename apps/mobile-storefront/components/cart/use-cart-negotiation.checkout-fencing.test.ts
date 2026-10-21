import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCartNegotiation } from './use-cart-negotiation';

const mockOpenNegotiation = jest.fn();
const mockClearNegotiatedPrice = jest.fn();

jest.mock('zustand/react/shallow', () => ({
  useShallow: <T>(selector: T) => selector,
}));

jest.mock('@/stores/ui-store', () => ({
  useUIStore: (
    selector: (state: {
      openNegotiation: typeof mockOpenNegotiation;
    }) => unknown
  ) => selector({ openNegotiation: mockOpenNegotiation }),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (
    selector: (state: {
      clearNegotiatedPrice: typeof mockClearNegotiatedPrice;
    }) => unknown
  ) => selector({ clearNegotiatedPrice: mockClearNegotiatedPrice }),
}));

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-1',
    product_id: 'product-1',
    slug: 'iphone-13-pro',
    name: 'iPhone 13 Pro',
    price: 500000,
    quantity: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
describe('checkout fencing intent', () => {
  it('marks opening a cart-wide negotiation as a checkout intent', async () => {
    const { sharedCartWriteRevision } = await import(
      '@/stores/shared-cart-writer'
    );
    const items = [createItem()];
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 500000 })
    );
    const before = sharedCartWriteRevision();
    act(() => {
      result.current.openTotalNegotiation();
    });
    expect(mockOpenNegotiation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'total' })
    );
    expect(sharedCartWriteRevision()).toBe(before + 1);
  });

  it('marks opening an item negotiation warning as a checkout intent', async () => {
    const { sharedCartWriteRevision } = await import(
      '@/stores/shared-cart-writer'
    );
    const items = [createItem()];
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 500000 })
    );
    const before = sharedCartWriteRevision();
    act(() => {
      result.current.openItemNegotiation(items[0]);
    });
    expect(result.current.showNegotiateWarning).toBe(true);
    expect(sharedCartWriteRevision()).toBe(before + 1);
  });

  it('marks opening an item negotiation as a checkout intent', async () => {
    const { sharedCartWriteRevision } = await import(
      '@/stores/shared-cart-writer'
    );
    const items = [createItem({ negotiatedPrice: 450000 })];
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 450000 })
    );
    const before = sharedCartWriteRevision();
    act(() => {
      result.current.actuallyOpenItemNegotiation(items[0]);
    });
    expect(mockOpenNegotiation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'single' })
    );
    expect(sharedCartWriteRevision()).toBe(before + 1);
  });
});

it('marks the cart-wide reset prompt as a checkout intent', async () => {
  const { sharedCartWriteRevision } = await import(
    '@/stores/shared-cart-writer'
  );
  mockOpenNegotiation.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
  const items = [createItem({ negotiatedPrice: 450000 })];
  const { result } = renderHook(() =>
    useCartNegotiation({ items, grandTotal: 450000 })
  );
  const before = sharedCartWriteRevision();
  act(() => {
    result.current.openTotalNegotiation();
  });
  expect(Alert.alert).toHaveBeenCalledWith(
    'Reset individual prices?',
    expect.any(String),
    expect.any(Array)
  );
  expect(mockOpenNegotiation).not.toHaveBeenCalled();
  expect(sharedCartWriteRevision()).toBe(before + 1);
});

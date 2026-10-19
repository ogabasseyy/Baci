import { renderHook } from '@testing-library/react-native';
import { useCheckoutDisplayCart } from './use-checkout-display-cart';

const mockClearCart = jest.fn();
let mockItems: Record<string, unknown>[] = [];
jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: (selector: (state: unknown) => unknown) =>
    selector({ enabled: false }),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: unknown) => unknown) =>
    selector({
      clearCart: mockClearCart,
      items: mockItems,
      subtotal: () => 400_000,
    }),
}));

describe('useCheckoutDisplayCart', () => {
  beforeEach(() => {
    mockItems = [
      { id: 'real-cart-item', name: 'Cart phone', price: 500_000, quantity: 1 },
    ];
  });
  it.each([
    'pending',
    'rejected',
    undefined,
  ])('does not display an unaccepted %s negotiation as the checkout price', (negotiationStatus) => {
    mockItems = [
      {
        id: 'phone',
        name: 'Phone',
        price: 500_000,
        quantity: 1,
        negotiatedPrice: 400_000,
        negotiationStatus,
      },
    ];
    const { result } = renderHook(() => useCheckoutDisplayCart());
    expect(result.current.items[0].negotiatedPrice).toBeUndefined();
    expect(result.current.items[0].price).toBe(500_000);
    expect(result.current.subtotal).toBe(500_000);
    expect(mockItems[0].negotiatedPrice).toBe(400_000);
  });
  it('preserves the accepted negotiated checkout price', () => {
    mockItems = [
      {
        id: 'phone',
        name: 'Phone',
        price: 500_000,
        quantity: 1,
        negotiatedPrice: 400_000,
        negotiationStatus: 'accepted',
      },
    ];
    const { result } = renderHook(() => useCheckoutDisplayCart());
    expect(result.current.items[0].negotiatedPrice).toBe(400_000);
    expect(result.current.subtotal).toBe(400_000);
  });
  it('uses the persisted cart outside simulation mode', () => {
    const { result } = renderHook(() => useCheckoutDisplayCart());

    expect(result.current.items).toEqual([
      { id: 'real-cart-item', name: 'Cart phone', price: 500_000, quantity: 1 },
    ]);
    expect(result.current.subtotal).toBe(500_000);
  });

  it('uses the zero-value non-persistent prize item during simulation', () => {
    const simulatedItem = {
      id: 'test-prize',
      name: 'iPhone XR',
      price: 0,
      product_id: 'product-1',
      quantity: 1,
      slug: 'iphone-xr',
    };
    const { result } = renderHook(() =>
      useCheckoutDisplayCart({
        item: simulatedItem,
        onComplete: jest.fn(),
      })
    );

    expect(result.current.items).toEqual([simulatedItem]);
    expect(result.current.subtotal).toBe(0);
  });
});

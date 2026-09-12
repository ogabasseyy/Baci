import { renderHook } from '@testing-library/react-native';
import { useCheckoutDisplayCart } from './use-checkout-display-cart';

const mockClearCart = jest.fn();

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: unknown) => unknown) =>
    selector({
      clearCart: mockClearCart,
      items: [{ id: 'real-cart-item', name: 'Cart phone' }],
      subtotal: () => 500_000,
    }),
}));

describe('useCheckoutDisplayCart', () => {
  it('uses the persisted cart outside simulation mode', () => {
    const { result } = renderHook(() => useCheckoutDisplayCart());

    expect(result.current.items).toEqual([
      { id: 'real-cart-item', name: 'Cart phone' },
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

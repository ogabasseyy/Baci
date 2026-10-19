import { isValidCartStore } from '@/lib/cart-validation';

describe('isValidCartStore', () => {
  it('returns true for a valid cart store shape', () => {
    expect(
      isValidCartStore({
        items: [],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(true);
  });

  it('returns true for a valid cart store with items', () => {
    expect(
      isValidCartStore({
        items: [
          {
            id: 'cart-item-1',
            product_id: 'product-1',
            slug: 'iphone-13-pro',
            name: 'iPhone 13 Pro',
            price: 500000,
            quantity: 2,
            negotiatedPrice: 480000,
            assuranceRate: 0.05,
          },
        ],
        itemCount: () => 1,
        subtotal: () => 500000,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(true);
  });

  it('returns false for invalid or missing fields', () => {
    const methodsOnly = {
      itemCount: () => 0,
      subtotal: () => 0,
      updateQuantity: () => {},
      removeItem: () => {},
      clearCart: () => {},
      toggleAssurance: () => {},
    };

    expect(isValidCartStore(undefined)).toBe(false);
    expect(isValidCartStore(null)).toBe(false);
    expect(isValidCartStore({})).toBe(false);
    expect(isValidCartStore(methodsOnly)).toBe(false);
    expect(
      isValidCartStore({
        items: {},
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: 'nope',
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: 'nope',
        clearCart: null,
        toggleAssurance: 123,
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [{ id: 1, quantity: '2' }],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [
          {
            id: 'cart-item-1',
            product_id: 'product-1',
            slug: 'iphone-13-pro',
            name: 'iPhone 13 Pro',
            price: 500000,
            quantity: 0,
          },
        ],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [
          {
            id: 'cart-item-2',
            product_id: 'product-2',
            slug: 'pixel-8',
            name: 'Pixel 8',
            price: 420000,
            quantity: 1,
            assuranceRate: Number.NaN,
          },
        ],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
    expect(
      isValidCartStore({
        items: [
          {
            id: 'cart-item-3',
            product_id: 'product-3',
            slug: 'galaxy-s24',
            name: 'Galaxy S24',
            price: 640000,
            quantity: 1,
            negotiatedPrice: 0,
          },
        ],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
      // A free (fully discounted) negotiation hydrates at zero and is
      // valid now that the canonical flow supports zero-price lines.
    ).toBe(true);
    expect(
      isValidCartStore({
        items: [
          {
            id: 'cart-item-4',
            product_id: 'product-4',
            slug: 'negative-deal',
            name: 'Negative Deal',
            price: 1000,
            quantity: 1,
            negotiatedPrice: -5,
          },
        ],
        itemCount: () => 0,
        subtotal: () => 0,
        updateQuantity: () => {},
        removeItem: () => {},
        clearCart: () => {},
        toggleAssurance: () => {},
      })
    ).toBe(false);
  });
});

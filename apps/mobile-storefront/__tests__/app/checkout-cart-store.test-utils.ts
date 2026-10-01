const mockCartState = {
  clearCart: jest.fn(),
  items: [
    {
      condition: 'New',
      id: 'cart-item-1',
      image_url: 'https://example.com/item.jpg',
      name: 'iPhone 11 Pro Max',
      price: 470000,
      product_id: 'product-1',
      quantity: 1,
      slug: 'iphone-11-pro-max',
      storage: '64GB',
    },
  ],
  subtotal: () => 470000,
};

const mockUseCartStore = Object.assign(
  (selector: (state: typeof mockCartState) => unknown) =>
    selector(mockCartState),
  {
    getState: () => mockCartState,
    subscribe: () => () => undefined,
    persist: {
      getOptions: () => ({
        name: 'cart-storage',
        partialize: (state: unknown) => state,
        version: 0,
      }),
    },
  }
);

jest.mock('@/stores/cart-store', () => ({
  formatPrice: (value: number) =>
    `₦${new Intl.NumberFormat('en-NG').format(value)}`,
  useCartStore: mockUseCartStore,
}));

export { mockCartState, mockUseCartStore };

import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useProductDetailCartState } from './use-product-detail-cart-state';

const mockCartStoreState = {
  addItem: jest.fn(),
  items: [],
  removeItem: jest.fn(),
  updateQuantity: jest.fn(),
};

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (
    selector: (state: typeof mockCartStoreState) => unknown
  ): unknown => selector(mockCartStoreState),
}));

describe('useProductDetailCartState', () => {
  it('uses an attribute-backed condition before the display fallback', () => {
    const { result } = renderHook(() =>
      useProductDetailCartState({
        currentVariantDisplaySelection: { condition: 'new' },
        effectiveSelectedAttributes: { condition: 'open_box' },
        effectiveSelectedColor: null,
        effectiveSelectedStorage: null,
        effectiveSelectedVariantId: 'open-box-256',
        offerConditionKey: null,
        product: {
          condition: 'new',
          id: 'product-1',
        },
      } as never)
    );

    expect(result.current.getConditionDisplay()).toBe('Open Box');
  });

  it('matches the cart line by resolved offer id, not condition alone', () => {
    mockCartStoreState.items = [
      {
        cartItemId: 'line-a',
        product_id: 'product-1',
        condition: 'Used',
        offer_id: 'offer-a',
        quantity: 2,
      },
      {
        cartItemId: 'line-b',
        product_id: 'product-1',
        condition: 'Used',
        offer_id: 'offer-b',
        quantity: 5,
      },
    ] as never;

    const { result } = renderHook(() =>
      useProductDetailCartState({
        currentVariantDisplaySelection: null,
        effectiveSelectedAttributes: {},
        effectiveSelectedColor: null,
        effectiveSelectedStorage: null,
        effectiveSelectedVariantId: null,
        offerConditionKey: 'used',
        routeOfferId: 'offer-b',
        suppressConditionOfferMatch: false,
        product: {
          condition: 'new',
          has_variants: false,
          id: 'product-1',
          offers: [
            { id: 'offer-a', condition: 'used' },
            { id: 'offer-b', condition: 'used' },
          ],
        },
      } as never)
    );

    expect(result.current.cartItem).toMatchObject({ cartItemId: 'line-b' });
    expect(result.current.quantityInCart).toBe(5);

    mockCartStoreState.items = [];
  });
});

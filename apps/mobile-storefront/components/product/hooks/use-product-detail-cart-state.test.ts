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

  it('matches a raw-code line against the display selection', () => {
    // Reprice reconciliation stores the raw live code ("open_box")
    // while the PDP selection formats as display ("Open Box").
    mockCartStoreState.items = [
      {
        cartItemId: 'line-raw',
        product_id: 'product-1',
        condition: 'open_box',
        offer_id: 'offer-b',
        quantity: 3,
      },
    ] as never;

    const { result } = renderHook(() =>
      useProductDetailCartState({
        currentVariantDisplaySelection: null,
        effectiveSelectedAttributes: {},
        effectiveSelectedColor: null,
        effectiveSelectedStorage: null,
        effectiveSelectedVariantId: null,
        offerConditionKey: 'open_box',
        routeOfferId: 'offer-b',
        suppressConditionOfferMatch: false,
        product: {
          condition: 'new',
          has_variants: false,
          id: 'product-1',
          offers: [{ id: 'offer-b', condition: 'open_box' }],
        },
      } as never)
    );

    expect(result.current.getConditionDisplay()).toBe('Open Box');
    expect(result.current.cartItem).toMatchObject({ cartItemId: 'line-raw' });
    expect(result.current.quantityInCart).toBe(3);

    mockCartStoreState.items = [];
  });

  it('totals sibling lines per product while skipping voucher lines', () => {
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
      {
        cartItemId: 'line-prize',
        product_id: 'product-1',
        quantity: 1,
        voucher_award_id: 'award-1',
      },
      {
        cartItemId: 'line-other',
        product_id: 'product-2',
        quantity: 9,
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

    expect(result.current.productQuantityInCart).toBe(7);

    mockCartStoreState.items = [];
  });

  it('excludes variant lines from the strict base-pool total', () => {
    // Variant inventory is separate from the base pool: a stale
    // variant line must not consume the UI total and make an
    // in-stock base line appear unavailable.
    mockCartStoreState.items = [
      {
        cartItemId: 'line-base',
        product_id: 'product-1',
        quantity: 2,
      },
      {
        cartItemId: 'line-variant',
        product_id: 'product-1',
        variant_id: 'variant-1',
        quantity: 4,
      },
    ] as never;

    const { result } = renderHook(() =>
      useProductDetailCartState({
        currentVariantDisplaySelection: null,
        effectiveSelectedAttributes: {},
        effectiveSelectedColor: null,
        effectiveSelectedStorage: null,
        effectiveSelectedVariantId: null,
        offerConditionKey: null,
        routeOfferId: null,
        suppressConditionOfferMatch: false,
        product: {
          condition: 'new',
          has_variants: false,
          id: 'product-1',
        },
      } as never)
    );

    expect(result.current.productQuantityInCart).toBe(2);

    mockCartStoreState.items = [];
  });
});

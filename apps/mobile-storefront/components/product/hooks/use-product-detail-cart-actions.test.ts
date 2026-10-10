import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useProductDetailCartActions } from './use-product-detail-cart-actions';

jest.mock('@/hooks/use-haptics', () => ({
  useHaptics: () => ({ success: jest.fn(), light: jest.fn() }),
}));

const mockTrackAddToCart = jest.fn();
jest.mock('@/services/tiktok-product-route-tracking', () => ({
  trackProductRouteAddToCart: (...args: unknown[]) =>
    mockTrackAddToCart(...args),
}));

const mockValidatedUpdateQuantity = jest.fn();
jest.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    updateQuantity: (...args: unknown[]) =>
      mockValidatedUpdateQuantity(...args),
  }),
}));

type CartActionsArgs = Parameters<typeof useProductDetailCartActions>;

function buildArgs(
  overrides: {
    routeData?: Record<string, unknown>;
    purchaseState?: Record<string, unknown>;
    cartState?: Record<string, unknown>;
  } = {}
) {
  const addItem = jest.fn();
  const routeData = {
    product: {
      id: 'iphone-15',
      slug: 'iphone-15',
      name: 'iPhone 15',
      brand: 'Apple',
      image: 'https://cdn.example.com/iphone-15-open-box.avif',
      has_variants: true,
    },
    effectiveSelectedColor: 'Black',
    effectiveSelectedStorage: '128GB',
    effectiveSelectedAttributes: {},
    effectiveSelectedVariantId: 'variant-black-128',
    resolvedColorImages: {
      Black: ['https://cdn.example.com/iphone-15-black.avif'],
      Yellow: ['https://cdn.example.com/iphone-15-yellow.avif'],
    },
    // Gallery is still showing the yellow frame (index 1) at add time.
    productGalleryImages: [
      'https://cdn.example.com/iphone-15-open-box.avif',
      'https://cdn.example.com/iphone-15-yellow.avif',
    ],
    selectedImageIndex: 1,
    currentVariantDisplaySelection: { variant: {} },
    ...overrides.routeData,
  };
  const purchaseState = {
    canPurchase: true,
    resolvedVariantPurchaseSelection: { id: 'variant-black-128' },
    effectivePrice: 600000,
    effectiveComparePrice: undefined,
    ...overrides.purchaseState,
  };
  const cartState = {
    addItem,
    getConditionDisplay: () => 'open_box',
    quantityInCart: 0,
    cartItem: null,
    updateQuantity: jest.fn(),
    removeItem: jest.fn(),
    ...overrides.cartState,
  };
  return {
    addItem,
    args: [routeData, cartState, purchaseState] as unknown as CartActionsArgs,
  };
}

describe('useProductDetailCartActions add-to-cart image', () => {
  beforeEach(() => {
    mockTrackAddToCart.mockClear();
  });

  it("uses the selected color's image even when the gallery shows another color", () => {
    const { addItem, args } = buildArgs();
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleAddToCart();
    });

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        color: 'Black',
        image_url: 'https://cdn.example.com/iphone-15-black.avif',
      })
    );
  });

  it('falls back to the displayed gallery frame when the color has no image', () => {
    const { addItem, args } = buildArgs({
      routeData: { resolvedColorImages: {} },
    });
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleAddToCart();
    });

    expect(addItem.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        image_url: 'https://cdn.example.com/iphone-15-yellow.avif',
      })
    );
  });
});

describe('useProductDetailCartActions catalog basis', () => {
  it('omits the catalog price for a non-variant condition offer', () => {
    const { addItem, args } = buildArgs({
      routeData: {
        product: {
          id: 'pixel-8',
          slug: 'pixel-8',
          name: 'Pixel 8',
          brand: 'Google',
          image: 'https://cdn.example.com/pixel-8.avif',
          has_variants: false,
          price: 410000,
          offers: [
            {
              id: 'offer-7',
              condition: 'used',
              price: 320000,
              stock_quantity: 3,
            },
          ],
        },
        offerConditionKey: 'used',
      },
      purchaseState: { effectivePrice: 320000 },
    });
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleAddToCart();
    });

    const added = addItem.mock.calls[0]?.[0];
    expect(added).toEqual(
      expect.objectContaining({
        price: 320000,
        offer_id: 'offer-7',
      })
    );
    expect(added).not.toHaveProperty('catalog_price');
  });

  it('routes stepper and typed quantity edits through the validated mutation', () => {
    const { args } = buildArgs({
      cartState: {
        quantityInCart: 1,
        cartItem: { id: 'line-1' },
      },
    });
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleUpdateQuantity(2);
    });
    act(() => {
      result.current.handleLocalQtyChange('3');
    });

    expect(mockValidatedUpdateQuantity).toHaveBeenCalledWith('line-1', 2);
    expect(mockValidatedUpdateQuantity).toHaveBeenCalledWith('line-1', 3);
    const cartState = args[1] as unknown as {
      updateQuantity: jest.Mock;
      removeItem: jest.Mock;
    };
    expect(cartState.updateQuantity).not.toHaveBeenCalled();
    expect(cartState.removeItem).not.toHaveBeenCalled();
  });

  it('omits the catalog price without a condition offer', () => {
    const { addItem, args } = buildArgs({
      routeData: {
        product: {
          id: 'pixel-8',
          slug: 'pixel-8',
          name: 'Pixel 8',
          brand: 'Google',
          image: 'https://cdn.example.com/pixel-8.avif',
          has_variants: false,
          price: 410000,
        },
        offerConditionKey: null,
      },
    });
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleAddToCart();
    });

    const added = addItem.mock.calls[0]?.[0];
    expect(added).toEqual(expect.objectContaining({ offer_id: undefined }));
    expect(added).not.toHaveProperty('catalog_price');
  });
});

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
  it('retains the catalog price for a non-variant condition offer', () => {
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
          offers: [{ condition: 'used', price: 320000, stock_quantity: 3 }],
        },
        offerConditionKey: 'used',
      },
      purchaseState: { effectivePrice: 320000 },
    });
    const { result } = renderHook(() => useProductDetailCartActions(...args));

    act(() => {
      result.current.handleAddToCart();
    });

    expect(addItem.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ price: 320000, catalog_price: 410000 })
    );
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

    expect(addItem.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ catalog_price: undefined })
    );
  });
});

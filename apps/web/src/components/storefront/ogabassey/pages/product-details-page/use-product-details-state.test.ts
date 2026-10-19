import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../types';
import { useProductDetailsState } from './use-product-details-state';

const mockAddToCart = vi.fn();
const mockApplyNegotiatedPrice = vi.fn();
const mockRemoveFromCart = vi.fn();
const mockShareProductLink = vi.fn().mockResolvedValue(undefined);
const mockUpdateQuantity = vi.fn();
const mockRouterPush = vi.fn();
const mockToast = vi.fn();

const mockUseSearchParams = vi.fn(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockRouterPush })),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    addToCart: mockAddToCart,
    applyNegotiatedPrice: mockApplyNegotiatedPrice,
    cart: [],
    removeFromCart: mockRemoveFromCart,
    updateQuantity: mockUpdateQuantity,
  })),
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: vi.fn(() => ({
    basePath: '',
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
    },
  })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

vi.mock('./product-share', () => ({
  shareProductLink: (args: unknown) => mockShareProductLink(args),
}));

vi.mock('../../providers/v2-saved-context', () => ({
  useV2Saved: vi.fn(() => ({
    isSaved: vi.fn(() => false),
    toggleSaved: vi.fn(),
  })),
}));

const baseProduct: Product = {
  id: 'product-1',
  name: 'Pixel 9',
  price: '₦5,000',
  rawPrice: 5000,
  image: 'https://example.com/default.jpg',
  images: [
    'https://example.com/default.jpg',
    'https://example.com/black.jpg',
    'https://example.com/silver.jpg',
  ],
  description: '<p>Phone description</p>',
  condition: 'new',
  category: 'Phones',
  colors: ['Black', 'Silver'],
  color_images: {
    Black: ['https://example.com/black.jpg'],
    Silver: ['https://example.com/silver.jpg'],
  },
  storage: ['128GB'],
} as Product;

describe('useProductDetailsState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('updates the selected color and matching image when a color is chosen', () => {
    const { result } = renderHook(() => useProductDetailsState(baseProduct));

    act(() => {
      result.current.handleColorSelection(1);
    });

    // Canonical variant media resolution places variant color images at the
    // head of the gallery, so selecting the second color (Silver) resolves
    // to the second gallery entry rather than the raw product-images index.
    expect(result.current.selectedColor).toBe(1);
    expect(result.current.selectedImage).toBe(1);
  });

  it('seeds the initial gallery image from the price-first variant color', () => {
    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        has_variants: true,
        variant_attributes: { storage: ['128GB'] },
        variants: [
          {
            id: 'variant-black-used',
            condition: 'used',
            attributes: { color: 'Black', storage: '128GB' },
            price_override: 5000,
            stock_quantity: 4,
          },
          {
            id: 'variant-silver-open-box',
            condition: 'open_box',
            attributes: { color: 'Silver', storage: '128GB' },
            price_override: 4000,
            stock_quantity: 2,
          },
        ],
      } as Product)
    );

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe(
      'variant-silver-open-box'
    );
    expect(result.current.selectedColor).toBe(1);
    expect(result.current.selectedImage).toBe(1);

    let wasAdded = false;
    act(() => {
      wasAdded = result.current.validateAndAddToCart();
    });

    expect(wasAdded).toBe(true);
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'https://example.com/silver.jpg',
        imageLarge: 'https://example.com/silver.jpg',
      }),
      1,
      expect.objectContaining({
        color: 'Silver',
        variantId: 'variant-silver-open-box',
      })
    );
  });

  it('opens the selection modal when required selections are missing', () => {
    const { result } = renderHook(() => useProductDetailsState(baseProduct));

    let wasAdded = true;
    act(() => {
      wasAdded = result.current.validateAndAddToCart();
    });

    expect(wasAdded).toBe(false);
    expect(result.current.isSelectionModalOpen).toBe(true);
    expect(result.current.missingFields).toContain('Color');
    expect(mockAddToCart).not.toHaveBeenCalled();
  });

  it('copies the current url when sharing succeeds', async () => {
    const { result } = renderHook(() => useProductDetailsState(baseProduct));

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockShareProductLink).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantName: 'Ogabassey',
        productName: 'Pixel 9',
        toast: mockToast,
        url: window.location.href,
      })
    );
  });

  it('surfaces share failures without emitting a success toast', async () => {
    mockShareProductLink.mockRejectedValueOnce(new Error('share failed'));

    const { result } = renderHook(() => useProductDetailsState(baseProduct));

    await expect(result.current.handleShare()).rejects.toThrow('share failed');
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('keeps the buy-now cart redirect scheduled across cart rerenders', () => {
    vi.useFakeTimers();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('action=buy'));

    const { rerender } = renderHook(() => useProductDetailsState(baseProduct));

    rerender();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockAddToCart).toHaveBeenCalledOnce();
    // The buy flow lands on the cart (assurance disclosure + opt-out),
    // never straight at checkout.
    expect(mockRouterPush).toHaveBeenCalledWith('/cart');
  });

  it('lets live selection move away from the seeded route variant', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('variantId=variant-new')
    );

    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        variant_attributes: {
          storage: ['128GB'],
        },
        variants: [
          {
            id: 'variant-new',
            condition: 'new',
            attributes: { storage: '128GB' },
            price_override: 5000,
            stock_quantity: 4,
          },
          {
            id: 'variant-used',
            condition: 'used',
            attributes: { storage: '128GB' },
            price_override: 4200,
            stock_quantity: 2,
          },
        ],
      } as Product)
    );

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe(
      'variant-new'
    );

    act(() => {
      result.current.setSelectedCondition('used');
    });

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe(
      'variant-used'
    );
  });

  it('keeps canPurchase true when a purchasable variant exists even if the display-preferred match is out of stock', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('variantId=used-cheap-out-of-stock')
    );

    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        condition: 'new',
        has_variants: true,
        variants: [
          {
            id: 'used-cheap-out-of-stock',
            condition: 'used',
            attributes: { storage: '128GB' },
            price_override: 4200,
            stock_quantity: 0,
          },
          {
            id: 'used-in-stock',
            condition: 'used',
            attributes: { storage: '128GB' },
            price_override: 4800,
            stock_quantity: 3,
          },
        ],
      } as Product)
    );

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe(
      'used-cheap-out-of-stock'
    );
    expect(result.current.canPurchase).toBe(true);
  });

  it('keeps unmanaged variant selections purchasable even when stock is zero', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('variantId=variant-unmanaged')
    );

    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        has_variants: true,
        manage_stock: false,
        variants: [
          {
            id: 'variant-unmanaged',
            condition: 'new',
            attributes: { storage: '128GB' },
            price_override: 5000,
            stock_quantity: 0,
          },
        ],
      } as Product)
    );

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe(
      'variant-unmanaged'
    );
    expect(result.current.canPurchase).toBe(true);
  });

  it('seeds selectedAttributes + selectedColor on SSR (no effect flushing) so mobile action bar renders "Add to Cart" not "Out of Stock"', async () => {
    // Use React's SSR renderer directly: it calls the component function once
    // with no useEffect flushing, mirroring the first paint that ships to the
    // browser. Before render-time seeding, selectedAttributes/selectedColor
    // were initialized to {}/null, currentVariantSelection resolved to null,
    // and canPurchase was false — the mobile action bar emitted "Out of
    // Stock" in SSR HTML for unmanaged-stock merchants with zero stock_quantity.
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');

    let ssrState:
      | ReturnType<typeof useProductDetailsState>
      | undefined;
    function Probe() {
      ssrState = useProductDetailsState({
        ...baseProduct,
        has_variants: true,
        manage_stock: false,
        variant_attributes: { storage: ['128GB', '256GB'] },
        variants: [
          {
            id: 'variant-128',
            condition: 'new',
            attributes: { storage: '128GB', color: 'Black' },
            price_override: 5000,
            stock_quantity: 0,
          },
          {
            id: 'variant-256',
            condition: 'new',
            attributes: { storage: '256GB', color: 'Black' },
            price_override: 6000,
            stock_quantity: 0,
          },
        ],
      } as Product);
      return null;
    }

    renderToString(createElement(Probe));

    expect(ssrState).toBeDefined();
    expect(ssrState?.canPurchase).toBe(true);
    expect(ssrState?.selectedAttributes).toMatchObject({ storage: '128GB' });
    expect(ssrState?.selectedColor).not.toBeNull();
  });

  it('preselects metadata-only single-option axes before validation', () => {
    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        attributeAxes: ['storage'],
        color_images: {},
        colors: [],
        images: ['https://example.com/default.jpg'],
        storage: ['128GB'],
        stock: 5,
        variant_attributes: { storage: ['128GB'] },
        variants: [],
      } as Product)
    );

    expect(result.current.selectedAttributes).toEqual({ storage: '128GB' });

    let wasAdded = false;
    act(() => {
      wasAdded = result.current.validateAndAddToCart();
    });

    expect(wasAdded).toBe(true);
    expect(result.current.isSelectionModalOpen).toBe(false);
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ storage: '128GB' }),
      1,
      expect.objectContaining({ storage: '128GB' })
    );
  });

  it('normalizes single metadata-only axes into variant selection', () => {
    const { result } = renderHook(() =>
      useProductDetailsState({
        ...baseProduct,
        attributeAxes: ['storage'],
        color_images: {},
        colors: [],
        images: ['https://example.com/default.jpg'],
        storage: ['128GB'],
        stock: 5,
        variant_attributes: { storage: ['128GB'] },
        variants: [
          {
            id: 'variant-new',
            condition: 'new',
            attributes: {},
            price_override: 5000,
            stock_quantity: 3,
          },
        ],
      } as Product)
    );

    expect(result.current.selectedAttributes).toEqual({ storage: '128GB' });
    expect(result.current.canPurchase).toBe(true);

    let wasAdded = false;
    act(() => {
      wasAdded = result.current.validateAndAddToCart();
    });

    expect(wasAdded).toBe(true);
    expect(result.current.isSelectionModalOpen).toBe(false);
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ storage: '128GB' }),
      1,
      expect.objectContaining({ storage: '128GB' })
    );
  });

  it('reopens selection before applying a negotiated price when choices are missing', () => {
    const { result } = renderHook(() => useProductDetailsState(baseProduct));

    act(() => {
      result.current.handleNegotiationSuccess(4500);
    });

    expect(result.current.isSelectionModalOpen).toBe(true);
    expect(result.current.missingFields).toContain('Color');
    expect(mockApplyNegotiatedPrice).not.toHaveBeenCalled();
  });

  describe('condition query param', () => {
    it('initializes selectedCondition from ?condition=used', () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('condition=used')
      );

      const { result } = renderHook(() =>
        useProductDetailsState(baseProduct)
      );

      expect(result.current.selectedCondition).toBe('used');
    });

    it('defaults to product base condition when no condition param exists', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams());

      const { result } = renderHook(() =>
        useProductDetailsState(baseProduct)
      );

      expect(result.current.selectedCondition).toBe('new');
    });

    it('falls back to base condition for invalid condition param', () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('condition=invalid')
      );

      const { result } = renderHook(() =>
        useProductDetailsState(baseProduct)
      );

      expect(result.current.selectedCondition).toBe('new');
    });
  });
  it('rejects a depleted strict-serialized variant under an unmanaged parent', () => {
    const { result } = renderHook(() => useProductDetailsState({
      ...baseProduct, manage_stock: false, has_variants: true,
      variants: [{ id: 'strict-empty', attributes: { storage: '128GB' },
        inventory_tracking_policy: 'serialized_strict', stock_quantity: 0 }],
    } as Product));
    expect(result.current.canPurchase).toBe(false);
  });

});

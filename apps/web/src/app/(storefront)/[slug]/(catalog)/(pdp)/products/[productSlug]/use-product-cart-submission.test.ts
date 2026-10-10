import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductVariant } from '@/lib/products';
import {
  type ProductCartSubmissionInput,
  useProductCartSubmission,
} from './use-product-cart-submission';

const { mockAddToCart, mockSetMerchantSlug, mockToast, mockTrackAddToCart } =
  vi.hoisted(() => ({
    mockAddToCart: vi.fn(),
    mockSetMerchantSlug: vi.fn(),
    mockToast: vi.fn(),
    mockTrackAddToCart: vi.fn(),
  }));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: mockAddToCart,
    setMerchantSlug: mockSetMerchantSlug,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/event-tracking', () => ({
  trackEvent: {
    addToCart: mockTrackAddToCart,
    productView: vi.fn(),
  },
}));

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
} as ProductCartSubmissionInput['merchant'];

function simpleProduct(overrides: Record<string, unknown> = {}): Product {
  return {
    condition: 'new',
    has_variants: false,
    id: 'product-1',
    manage_stock: true,
    name: 'Phone',
    price: 500_000,
    stock: 5,
    ...overrides,
  } as Product;
}

function variant(overrides: Record<string, unknown> = {}): ProductVariant {
  return {
    attributes: { color: 'Blue' },
    id: 'variant-1',
    merchant_id: 'merchant-1',
    product_id: 'product-1',
    stock_quantity: 3,
    ...overrides,
  } as ProductVariant;
}

function input(
  overrides: Partial<ProductCartSubmissionInput> = {}
): ProductCartSubmissionInput {
  return {
    currencyCode: 'NGN',
    currentPrice: 500_000,
    currentVariantSelection: null,
    effectiveVariantAttributes: {},
    merchant,
    product: simpleProduct(),
    quantity: 1,
    selectedCondition: 'new',
    selectedOffer: null,
    ...overrides,
  };
}

describe('useProductCartSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a simple product with the merchant slug, tracking, and confirmation', () => {
    const { result } = renderHook(() => useProductCartSubmission(input()));

    act(() => {
      result.current();
    });

    const product = simpleProduct();
    expect(mockSetMerchantSlug).toHaveBeenCalledWith('ogabassey');
    expect(mockAddToCart).toHaveBeenCalledWith(product, 1, undefined);
    expect(mockTrackAddToCart).toHaveBeenCalledWith(
      'merchant-1',
      product,
      1,
      'NGN'
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to cart!' })
    );
  });

  it('carries the variant price and availability onto the cart line', () => {
    const selected = variant();
    const { result } = renderHook(() =>
      useProductCartSubmission(
        input({
          currentPrice: 450_000,
          currentVariantSelection: { variant: selected },
          effectiveVariantAttributes: { color: 'Blue' },
          product: simpleProduct({ has_variants: true }),
        })
      )
    );

    act(() => {
      result.current();
    });

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 450_000, stock: 3 }),
      1,
      {
        condition: 'new',
        variantAttributes: { color: 'Blue' },
        variantId: 'variant-1',
      }
    );
  });

  it('submits an offer selection with the offer id', () => {
    const selectedOffer = {
      condition: 'open_box',
      id: 'offer-1',
      price: 400_000,
      stock_quantity: 2,
    } as ProductCartSubmissionInput['selectedOffer'];
    const { result } = renderHook(() =>
      useProductCartSubmission(
        input({
          currentPrice: 400_000,
          selectedCondition: 'open_box',
          selectedOffer,
        })
      )
    );

    act(() => {
      result.current();
    });

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 400_000, stock: 2 }),
      1,
      { condition: 'open_box', offerId: 'offer-1' }
    );
  });

  it('requires a variant choice for variant products', () => {
    const { result } = renderHook(() =>
      useProductCartSubmission(
        input({ product: simpleProduct({ has_variants: true }) })
      )
    );

    act(() => {
      result.current();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Select a variant',
        variant: 'destructive',
      })
    );
    expect(mockAddToCart).not.toHaveBeenCalled();
  });
});

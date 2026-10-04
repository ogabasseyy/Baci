import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useProductOfferSelection } from './use-product-offer-selection';

const mockUseSearchParams = vi.fn(() => new URLSearchParams());
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

const baseProduct = {
  id: 'p1',
  name: 'Phone',
  description: 'A phone',
  status: 'active',
  price: 100,
  compare_at_price: 120,
  manage_stock: true,
  stock: 10,
  image: '/p.jpg',
  imageLarge: '/p.jpg',
  imageHint: 'phone',
  brand: 'Acme',
  gtin: '1',
  mpn: '1',
  condition: 'new',
  has_variants: false,
  offers: [
    { id: 'o1', condition: 'used', price: 80, stock_quantity: 3 },
    { id: 'o2', condition: 'open_box', price: 90, stock_quantity: 0 },
  ],
} as unknown as Product;

const variantProduct = {
  ...baseProduct,
  id: 'p2',
  has_variants: true,
  offers: undefined,
  variants: [
    {
      id: 'v1',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '128 GB' },
      price_override: 100,
      stock_quantity: 5,
    },
    {
      id: 'v2',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '256 GB' },
      price_override: 150,
      stock_quantity: 5,
    },
  ],
} as unknown as Product;

describe('useProductOfferSelection', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('honors a forwarded offer id that matches the selected condition', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=used&offer_id=o1')
    );
    const { result } = renderHook(() => useProductOfferSelection(baseProduct));
    expect(result.current.selectedCondition).toBe('used');
    expect(result.current.selectedOffer?.id).toBe('o1');
    expect(result.current.currentPrice).toBe(80);
  });

  it('ignores a forwarded offer id that names no offer', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('offer_id=nope'));
    const { result } = renderHook(() => useProductOfferSelection(baseProduct));
    expect(result.current.selectedOffer).toBeNull();
    expect(result.current.currentPrice).toBe(100);
  });

  it('drops the route offer when the shopper picks another condition', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=used&offer_id=o1')
    );
    const { result } = renderHook(() => useProductOfferSelection(baseProduct));
    expect(result.current.selectedOffer?.id).toBe('o1');
    act(() => {
      result.current.handleConditionChange('new');
    });
    expect(result.current.selectedCondition).toBe('new');
    expect(result.current.selectedOffer).toBeNull();
    expect(result.current.currentPrice).toBe(100);
  });

  it('reseeds the condition when the route condition changes', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
    const { result, rerender } = renderHook(() =>
      useProductOfferSelection(baseProduct)
    );
    expect(result.current.selectedCondition).toBe('new');
    mockUseSearchParams.mockReturnValue(new URLSearchParams('condition=used'));
    rerender();
    expect(result.current.selectedCondition).toBe('used');
    expect(result.current.selectedOffer?.id).toBe('o1');
    expect(result.current.currentPrice).toBe(80);
  });

  it('seeds the default variant and follows attribute changes', () => {
    const { result } = renderHook(() =>
      useProductOfferSelection(variantProduct)
    );
    expect(result.current.effectiveVariantId).toBe('v1');
    act(() => {
      result.current.handleAttributeChange('storage', '256 GB');
    });
    expect(result.current.effectiveVariantId).toBe('v2');
    expect(result.current.currentPrice).toBe(150);
  });
});

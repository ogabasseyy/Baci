import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductOfferSelector } from './product-offer-selector';
import type { ProductCondition } from './product-selection-condition';

function renderSelector({
  basePrice,
  offerPrice,
}: {
  basePrice: number;
  offerPrice: number;
}) {
  const product = {
    condition: 'new',
    has_condition_offers: true,
    id: 'p1',
    name: 'Widget',
    offers: [
      { condition: 'used', id: 'o1', price: offerPrice, stock_quantity: 3 },
    ],
    price: basePrice,
  } as Product;
  render(
    <ProductOfferSelector
      conditionDescriptions={{}}
      conditionLabels={{ used: 'Premium Used' }}
      formatCurrency={(value) => `NGN${value}`}
      onConditionChange={vi.fn()}
      product={product}
      selectedCondition={'used' as ProductCondition}
      selectedOffer={product.offers?.[0] ?? null}
    />
  );
}

describe('ProductOfferSelector savings message', () => {
  it('shows Save when the offer undercuts New', () => {
    renderSelector({ basePrice: 50000, offerPrice: 30000 });

    expect(screen.getByText(/Save/)).toHaveTextContent('Save NGN20000 vs New');
  });

  it('hides Save when the offer costs more than New', () => {
    renderSelector({ basePrice: 50000, offerPrice: 60000 });

    expect(screen.queryByText(/Save/)).toBeNull();
  });

  it('hides Save when the offer matches New', () => {
    renderSelector({ basePrice: 50000, offerPrice: 50000 });

    expect(screen.queryByText(/Save/)).toBeNull();
  });
});

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

describe('ProductOfferSelector base highlight', () => {
  it('does not highlight the base button alongside a same-condition exact offer', () => {
    const product = {
      condition: 'used',
      has_condition_offers: true,
      id: 'p1',
      name: 'Widget',
      offers: [
        { condition: 'used', id: 'o1', price: 30000, stock_quantity: 3 },
      ],
      price: 50000,
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

    // Both buttons render the same label; exactly one may carry the
    // selected style — the resolved offer, never the base.
    const selected = screen
      .getAllByRole('button', { name: 'Premium Used' })
      .filter((button) => button.className.includes('border-store-primary'));
    expect(selected).toHaveLength(1);
  });

  it('highlights the base button when no exact offer is selected', () => {
    const product = {
      condition: 'used',
      has_condition_offers: true,
      id: 'p1',
      name: 'Widget',
      offers: [
        { condition: 'used', id: 'o1', price: 30000, stock_quantity: 3 },
      ],
      price: 50000,
    } as Product;
    render(
      <ProductOfferSelector
        conditionDescriptions={{}}
        conditionLabels={{ used: 'Premium Used' }}
        formatCurrency={(value) => `NGN${value}`}
        onConditionChange={vi.fn()}
        product={product}
        selectedCondition={'used' as ProductCondition}
        selectedOffer={null}
      />
    );

    // No exact offer: the base button owns the selection and the
    // same-condition offer button stays unselected.
    const buttons = screen.getAllByRole('button', { name: 'Premium Used' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].className).toContain('border-store-primary');
    expect(buttons[1].className).not.toContain('border-store-primary');
  });
});

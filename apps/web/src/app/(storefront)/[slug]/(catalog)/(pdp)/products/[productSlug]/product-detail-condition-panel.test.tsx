import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailConditionPanel } from './product-detail-condition-panel';
import type { ProductCondition } from './product-selection-condition';

vi.mock('./product-offer-selector', () => ({
  ProductOfferSelector: () => <div data-testid="offer-selector" />,
}));

const base = {
  formatCurrency: (value: number) => `NGN${value}`,
  onConditionChange: vi.fn(),
  selectedOffer: null,
  routeOfferMissing: false,
  routeVariantMissing: false,
} as const;

describe('ProductDetailConditionPanel', () => {
  it('renders variant-condition buttons with themed inactive state', () => {
    const onConditionChange = vi.fn();
    render(
      <ProductDetailConditionPanel
        product={{} as Product}
        usesVariantConditions
        availableConditionOptions={['new', 'used'] as ProductCondition[]}
        conditionLabels={{ new: 'New', used: 'Premium Used' }}
        conditionDescriptions={{}}
        selectedCondition={'new' as ProductCondition}
        onConditionChange={onConditionChange}
        selectedOffer={null}
        formatCurrency={base.formatCurrency}
        routeOfferMissing={false}
        routeVariantMissing={false}
      />
    );
    const unselected = screen.getByRole('button', { name: 'Premium Used' });
    expect(unselected.className).toContain('border-store-border');
    expect(unselected.className).not.toContain('gray-');
    fireEvent.click(unselected);
    expect(onConditionChange).toHaveBeenCalledWith('used');
  });

  it('delegates to the offer selector when exact offers exist', () => {
    render(
      <ProductDetailConditionPanel
        product={
          {
            has_condition_offers: true,
            offers: [{ id: 'o1', condition: 'used', price: 30000 }],
          } as unknown as Product
        }
        usesVariantConditions={false}
        availableConditionOptions={[]}
        conditionLabels={{}}
        conditionDescriptions={{}}
        selectedCondition={'new' as ProductCondition}
        onConditionChange={base.onConditionChange}
        selectedOffer={null}
        formatCurrency={base.formatCurrency}
        routeOfferMissing={false}
        routeVariantMissing={false}
      />
    );
    expect(screen.getByTestId('offer-selector')).toBeDefined();
  });

  it('alerts when a routed offer or variant is gone', () => {
    render(
      <ProductDetailConditionPanel
        product={{ condition: 'new' } as Product}
        usesVariantConditions={false}
        availableConditionOptions={[]}
        conditionLabels={{}}
        conditionDescriptions={{}}
        selectedCondition={'new' as ProductCondition}
        onConditionChange={base.onConditionChange}
        selectedOffer={null}
        formatCurrency={base.formatCurrency}
        routeOfferMissing
        routeVariantMissing
      />
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
  });
});

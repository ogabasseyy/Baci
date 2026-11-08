import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  type ProductWithSelectionAxesLike,
  resolveVariantSelection,
} from '@baci/shared/lib';
import type { ProductVariant } from '@/lib/products';
import type { NormalizedProductDetails } from './product-details-helpers';
import { ProductOptionSelectors } from './product-option-selectors';

function buildProductData(
  overrides: Partial<NormalizedProductDetails> = {}
): NormalizedProductDetails {
  return {
    id: 'prod-1',
    name: 'Tablet Pro',
    slug: 'tablet-pro',
    price: '₦500,000',
    rawPrice: 500000,
    image: 'https://example.com/img.jpg',
    images: ['https://example.com/img.jpg'],
    description: 'A versatile tablet.',
    brand: 'Apple',
    condition: 'open_box',
    rating: 0,
    reviewCount: 0,
    specs: [],
    detailedSpecs: [],
    colors: [],
    colorImages: {},
    storage: [],
    platforms: [],
    displaySize: '',
    ram: '',
    ...overrides,
  };
}

function ConnectivityIntegrationHarness() {
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({
    storage: '128GB',
  });

  const variants = [
    {
      id: 'variant-wifi',
      attributes: { storage: '128GB', sim_type: 'Wi-Fi Only' },
      price_override: 500000,
      stock_quantity: 10,
    },
    {
      id: 'variant-cellular',
      attributes: { storage: '256GB', sim_type: 'Cellular' },
      price_override: 600000,
      stock_quantity: 10,
    },
  ];

  const productData = buildProductData({ variants });
  const resolvedVariant = resolveVariantSelection(
    productData as unknown as ProductWithSelectionAxesLike<ProductVariant>,
    { attributes: selectedAttributes }
  )?.variant;

  return (
    <div>
      <span data-testid="cart-variant-id">{resolvedVariant?.id}</span>
      <ProductOptionSelectors
        deliveryEstimate="1–2 days"
        deliveryLocation="Lagos"
        descriptionExcerpt="Great tablet."
        effectiveAxes={['storage']}
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => ['128GB', '256GB']}
        onChangeDeliveryLocation={vi.fn()}
        onSelectAttribute={(axis, value) =>
          setSelectedAttributes((prev) => ({ ...prev, [axis]: value }))
        }
        onSelectColor={vi.fn()}
        onSelectSecondaryColor={vi.fn()}
        productData={productData}
        secondaryColor={null}
        selectedAttributes={selectedAttributes}
        selectedColor={null}
        selectedVariant={resolvedVariant}
        showColorToast={false}
      />
    </div>
  );
}

describe('ProductOptionSelectors — connectivity note integration', () => {
  it('updates cart variant ID and toggles connectivity disclosure note on user selection', async () => {
    const user = userEvent.setup();
    render(<ConnectivityIntegrationHarness />);

    // Initial state: 128GB selected -> variant-wifi -> note displayed
    expect(screen.getByTestId('cart-variant-id')).toHaveTextContent(
      'variant-wifi'
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'confirm connectivity limitations before purchase'
    );

    // Switch to 256GB -> variant-cellular -> note disappears
    await user.click(screen.getByRole('button', { name: /Select 256GB storage/i }));
    expect(screen.getByTestId('cart-variant-id')).toHaveTextContent(
      'variant-cellular'
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    // Switch back to 128GB -> variant-wifi -> note reappears
    await user.click(screen.getByRole('button', { name: /Select 128GB storage/i }));
    expect(screen.getByTestId('cart-variant-id')).toHaveTextContent(
      'variant-wifi'
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'confirm connectivity limitations before purchase'
    );
  });
});

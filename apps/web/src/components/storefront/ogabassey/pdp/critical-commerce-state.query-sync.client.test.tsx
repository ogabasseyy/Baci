import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatCriticalPrice } from './critical-commerce-selection';
import {
  OgabasseyPdpCriticalCommerceProvider,
  OgabasseyPdpCriticalQuerySync,
  useOgabasseyPdpCriticalCommerce,
} from './critical-commerce.client';
import { createCriticalCartProduct } from './critical-cart-product';

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: vi.fn(),
    cart: [],
    sharedCartEnabled: false,
    updateQuantity: vi.fn(),
  }),
}));

const multiVariantProduct = createCriticalCartProduct({
  id: 'prod-1',
  brand: 'Samsung',
  description: 'Galaxy S24 Ultra',
  gtin: '',
  name: 'Galaxy S24 Ultra',
  slug: 'galaxy-s24-ultra',
  price: 900_000,
  status: 'active',
  manage_stock: true,
  mpn: 'galaxy-s24-ultra',
  stock: 10,
  stock_quantity: 10,
  has_variants: true,
  image: 'https://cdn.ogabassey.com/core-assets/products/s24-default.avif',
  imageHint: 'Galaxy S24 Ultra',
  imageLarge: 'https://cdn.ogabassey.com/core-assets/products/s24-default.avif',
  variants: [
    {
      id: 'var-new-256',
      product_id: 'prod-1',
      merchant_id: 'merchant-1',
      attributes: { storage: '256GB' },
      condition: 'new',
      price_override: 750_000,
      stock_quantity: 4,
    },
    {
      id: 'var-used-512',
      product_id: 'prod-1',
      merchant_id: 'merchant-1',
      attributes: { storage: '512GB' },
      condition: 'used',
      price_override: 900_000,
      stock_quantity: 3,
    },
  ],
  offers: [
    {
      id: 'offer-used',
      condition: 'used',
      price: 720_000,
      stock_quantity: 2,
    },
  ],
});

const offerOnlyProduct = createCriticalCartProduct({
  id: 'prod-offer-only',
  brand: 'Google',
  description: 'Pixel 9 Pro',
  gtin: '',
  name: 'Pixel 9 Pro',
  slug: 'pixel-9-pro',
  price: 900_000,
  status: 'active',
  manage_stock: true,
  mpn: 'pixel-9-pro',
  stock: 5,
  stock_quantity: 5,
  has_variants: false,
  image: 'https://cdn.ogabassey.com/core-assets/products/pixel-9-pro.avif',
  imageHint: 'Pixel 9 Pro',
  imageLarge: 'https://cdn.ogabassey.com/core-assets/products/pixel-9-pro.avif',
  variants: [],
  offers: [
    {
      id: 'offer-used',
      condition: 'used',
      price: 720_000,
      stock_quantity: 2,
    },
  ],
});

function Probe() {
  const commerce = useOgabasseyPdpCriticalCommerce();
  return (
    <div>
      <span data-testid="selected-storage">
        {commerce.selectedAttributes.storage ?? ''}
      </span>
      <span data-testid="selected-condition">
        {commerce.selectedAttributes.condition ?? ''}
      </span>
      <span data-testid="price">
        {formatCriticalPrice(commerce.productForCart.price, commerce.currency)}
      </span>
      <span data-testid="missing-offer">
        {String(commerce.routeOfferMissingActive)}
      </span>
      <button
        onClick={() => commerce.handleAttributeSelection('storage', '256GB')}
        type="button"
      >
        Pick 256GB
      </button>
    </div>
  );
}

describe('OgabasseyPdpCriticalQuerySync', () => {
  it('applies streamed variant and offer selections into critical commerce state', () => {
    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={multiVariantProduct}
        variantAxes={['storage']}
        variantAxisOptions={{ storage: ['256GB', '512GB'] }}
        variantCount={2}
      >
        <Probe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByTestId('selected-storage')).toHaveTextContent('256GB');

    act(() => {
      rerender(
        <OgabasseyPdpCriticalCommerceProvider
          cartProduct={multiVariantProduct}
          variantAxes={['storage']}
          variantAxisOptions={{ storage: ['256GB', '512GB'] }}
          variantCount={2}
        >
          <OgabasseyPdpCriticalQuerySync
            initialOfferId="offer-used"
            initialVariantSelection={{
              attributes: { storage: '512GB' },
              condition: 'used',
              variantId: 'var-used-512',
            }}
            routeOfferMissing={false}
          />
          <Probe />
        </OgabasseyPdpCriticalCommerceProvider>
      );
    });

    expect(screen.getByTestId('selected-storage')).toHaveTextContent('512GB');
    expect(screen.getByTestId('selected-condition')).toHaveTextContent('used');
    expect(screen.getByTestId('price')).toHaveTextContent('900,000');
  });

  it('applies streamed exact route offers and missing-offer gates when the shopper has not interacted', () => {
    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={offerOnlyProduct}
        variantCount={0}
      >
        <Probe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByTestId('price')).toHaveTextContent('900,000');
    expect(screen.getByTestId('missing-offer')).toHaveTextContent('false');

    act(() => {
      rerender(
        <OgabasseyPdpCriticalCommerceProvider
          cartProduct={offerOnlyProduct}
          variantCount={0}
        >
          <OgabasseyPdpCriticalQuerySync
            initialOfferId="offer-used"
            routeOfferMissing={false}
          />
          <Probe />
        </OgabasseyPdpCriticalCommerceProvider>
      );
    });

    expect(screen.getByTestId('price')).toHaveTextContent('720,000');

    act(() => {
      rerender(
        <OgabasseyPdpCriticalCommerceProvider
          cartProduct={offerOnlyProduct}
          variantCount={0}
        >
          <OgabasseyPdpCriticalQuerySync routeOfferMissing />
          <Probe />
        </OgabasseyPdpCriticalCommerceProvider>
      );
    });

    expect(screen.getByTestId('missing-offer')).toHaveTextContent('true');
  });

  it('surfaces missing route offer without overriding an explicit shopper interaction', () => {
    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={multiVariantProduct}
        variantAxes={['storage']}
        variantAxisOptions={{ storage: ['256GB', '512GB'] }}
        variantCount={2}
      >
        <Probe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pick 256GB' }));

    act(() => {
      rerender(
        <OgabasseyPdpCriticalCommerceProvider
          cartProduct={multiVariantProduct}
          variantAxes={['storage']}
          variantAxisOptions={{ storage: ['256GB', '512GB'] }}
          variantCount={2}
        >
          <OgabasseyPdpCriticalQuerySync
            initialVariantSelection={{
              attributes: { storage: '512GB' },
              condition: 'used',
              variantId: 'var-used-512',
            }}
            routeOfferMissing
          />
          <Probe />
        </OgabasseyPdpCriticalCommerceProvider>
      );
    });

    expect(screen.getByTestId('selected-storage')).toHaveTextContent('256GB');
    expect(screen.getByTestId('missing-offer')).toHaveTextContent('false');
  });
});

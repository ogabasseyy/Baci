import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceProvider,
  useOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    setIsCartOpen: cartMocks.setIsCartOpen,
  }),
}));

const nonVariantProduct: CartProduct = {
  brand: 'Xiaomi',
  condition: 'new',
  description: 'Redmi Pad 2',
  gtin: '',
  has_variants: false,
  id: 'redmi-pad-2',
  image: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  imageHint: 'Redmi Pad 2',
  imageLarge: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  manage_stock: true,
  mpn: 'redmi-pad-2',
  name: 'Redmi Pad 2',
  price: 237_674.42,
  status: 'active',
  stock: 10,
};

function CriticalCommerceStateProbe() {
  const commerce = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <p>axes:{commerce.renderableVariantAxes.join(',')}</p>
      <p>selected ram:{commerce.selectedAttributes.ram || ''}</p>
      <p>{commerce.canAddToCart ? 'ready' : 'blocked'}</p>
    </>
  );
}

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
});

describe('OgabasseyPdpCriticalCommerceProvider single-option metadata', () => {
  it('hides single-option axes on non-variant products and stays purchasable', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={nonVariantProduct}
        variantAxes={['ram']}
        variantAxisOptions={{ ram: ['8GB'] }}
        variantCount={0}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:')).toBeInTheDocument();
    expect(screen.getByText('selected ram:')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });
});

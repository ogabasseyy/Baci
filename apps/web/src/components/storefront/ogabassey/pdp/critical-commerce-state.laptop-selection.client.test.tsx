import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceProvider,
  useOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  cart: [] as Array<{ quantity: number } & Record<string, unknown>>,
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    setIsCartOpen: cartMocks.setIsCartOpen,
  }),
}));

const variantCartProduct: CartProduct = {
  brand: 'Xiaomi',
  condition: 'new',
  description: 'Redmi Pad 2',
  gtin: '',
  has_variants: true,
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
  variants: [
    {
      attributes: { ram: '4GB', storage: '128GB' },
      id: 'variant-128-4',
      merchant_id: 'merchant-1',
      price_override: 237_674.42,
      product_id: 'redmi-pad-2',
      stock_quantity: 10,
    },
    {
      attributes: { ram: '8GB', storage: '256GB' },
      id: 'variant-256-8',
      merchant_id: 'merchant-1',
      price_override: 278_418.6,
      product_id: 'redmi-pad-2',
      stock_quantity: 8,
    },
  ],
};

function CriticalCommerceStateProbe() {
  const commerce = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <p>{commerce.productForCart.price}</p>
      <p>currency:{commerce.currency.code}</p>
      <p>in cart:{commerce.quantityInCart}</p>
      <p>{commerce.canAddToCart ? 'ready' : 'blocked'}</p>
      <p>axes:{commerce.renderableVariantAxes.join(',')}</p>
      <p>explicit axes:{commerce.explicitSelectedAxes.join(',')}</p>
      <p>selected condition:{commerce.selectedAttributes.condition || ''}</p>
      <p>selected storage:{commerce.selectedAttributes.storage || ''}</p>
      <p>selected ram:{commerce.selectedAttributes.ram || ''}</p>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'new')}
        type="button"
      >
        Select new condition
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'used')}
        type="button"
      >
        Select used condition
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('storage', '256GB')}
        type="button"
      >
        Select 256GB storage
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('ram', '16GB')}
        type="button"
      >
        Select 16GB RAM
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('ram', '8GB')}
        type="button"
      >
        Select 8GB RAM
      </button>
      <button
        onClick={() =>
          commerce.handleAttributeSelection(
            'processor',
            'Intel Core Ultra 7 155H'
          )
        }
        type="button"
      >
        Select Intel Core Ultra 7 processor
      </button>
      <button
        disabled={!commerce.canAddToCart}
        onClick={commerce.handleAddToCart}
        type="button"
      >
        Add to cart
      </button>
    </>
  );
}

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.cart = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('laptop variant selection', () => {
  it('retains only jointly compatible siblings when completing a laptop SKU', () => {
    const configurations = [
      { storage: '128GB', ram: '4GB', processor: 'M5' },
      { storage: '256GB', ram: '4GB', processor: 'M5 Pro' },
      { storage: '256GB', ram: '8GB', processor: 'M5' },
    ];
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: configurations.map((attributes, index) => ({
            ...variantCartProduct.variants?.[0],
            attributes,
            id: `laptop-${index}`,
            merchant_id: 'merchant-1',
            product_id: 'laptop',
            price_override: 2000000 + index * 100000,
            stock_quantity: 10,
          })),
        }}
        variantAxes={['storage', 'ram', 'processor']}
        variantCount={3}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /select 256gb storage/i }));
    expect(screen.getByText('selected storage:256GB')).toBeInTheDocument();
    expect(screen.getByText('selected ram:4GB')).toBeInTheDocument();
    expect(screen.getByText('2100000')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 2100000 }),
      1,
      expect.objectContaining({
        variantId: 'laptop-1',
        variantAttributes: configurations[1],
      })
    );
  });

});

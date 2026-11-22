import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceProvider } from './critical-commerce-state.client';
import {
  CriticalCommerceStateProbe,
  variantCartProduct,
} from './critical-commerce-state.test-support';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  cart: [] as Array<{ quantity: number } & Record<string, unknown>>,
  sharedCartEnabled: false,
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    setIsCartOpen: cartMocks.setIsCartOpen,
    sharedCartEnabled: cartMocks.sharedCartEnabled,
  }),
}));

const simpleWidgetProduct: CartProduct = {
  brand: 'OgaBassey',
  condition: 'new',
  description: 'Simple Widget',
  gtin: '',
  has_variants: false,
  id: 'simple-1',
  image: 'https://cdn.ogabassey.com/simple-1.avif',
  imageHint: 'Simple Widget',
  imageLarge: 'https://cdn.ogabassey.com/simple-1.avif',
  manage_stock: false,
  mpn: 'simple-1',
  name: 'Simple Widget',
  price: 5000,
  status: 'active',
  stock: 0,
  variants: [],
};

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.cart = [];
  cartMocks.sharedCartEnabled = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('OgabasseyPdpCriticalCommerceProvider', () => {
  it('shares selected variant state with summary and cart controls', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={variantCartProduct}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('237674.42')).toBeInTheDocument();
    expect(screen.getByText('currency:NGN')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /select 256gb storage/i })
    );

    expect(screen.getByText('selected ram:8GB')).toBeInTheDocument();
    expect(screen.getByText('278418.6')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /select 8gb ram/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 278_418.6,
        stock: 8,
      }),
      1,
      expect.objectContaining({
        storage: '256GB',
        variantAttributes: {
          ram: '8GB',
          storage: '256GB',
        },
        variantId: 'variant-256-8',
      })
    );
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });

  it('reports zero in-cart units for a fresh selection', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={variantCartProduct}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('in cart:0')).toBeInTheDocument();
  });

  it('reports the merging line quantity for the exact selection', () => {
    cartMocks.cart = [{ id: 'simple-1', condition: 'new', quantity: 2 }];
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={simpleWidgetProduct}
        variantAxes={[]}
        variantCount={0}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('in cart:2')).toBeInTheDocument();
  });

  it('caps PDP increments at SHARED_CART_MAX_QUANTITY_PER_LINE on shared-cart storefronts', () => {
    cartMocks.sharedCartEnabled = true;
    cartMocks.cart = [{ id: 'simple-1', condition: 'new', quantity: 10 }];

    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={simpleWidgetProduct}
        variantAxes={[]}
        variantCount={0}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('max:10')).toBeInTheDocument();
    expect(screen.getByText('at max:true')).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{ ...simpleWidgetProduct, manage_stock: true, stock: 50 }}
        variantAxes={[]}
        variantCount={0}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('max:10')).toBeInTheDocument();
    expect(screen.getByText('at max:true')).toBeInTheDocument();
  });

  it('reports zero in-cart units when a required variant axis is unselected even if the default SKU is in the cart', () => {
    cartMocks.cart = [
      {
        cartItemId: 'redmi-pad-2::variant-black',
        condition: 'new',
        id: 'redmi-pad-2',
        quantity: 2,
        variantId: 'variant-black',
      },
    ];

    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: [
            {
              attributes: { color: 'Black' },
              id: 'variant-black',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
            {
              attributes: { color: 'Blue' },
              id: 'variant-blue',
              merchant_id: 'merchant-1',
              price_override: 278_418.6,
              product_id: 'redmi-pad-2',
              stock_quantity: 6,
            },
          ],
        }}
        variantAxes={[]}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('in cart:0')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('exposes the merchant-resolved currency supplied to the provider', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={variantCartProduct}
        currency={{ code: 'INR', symbol: '₹', locale: 'en-IN' }}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('currency:INR')).toBeInTheDocument();
  });
});

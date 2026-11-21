import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpCriticalCommerceProvider } from './critical-commerce-state.client';
import {
  CriticalCommerceStateProbe,
  variantCartProduct,
} from './critical-commerce-state.test-support';

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

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.cart = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OgabasseyPdpCriticalCommerceProvider condition and single-SKU selection', () => {
  it('allows the default SKU when no variant options require selection', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          price: 237_674.42,
          variants: [
            {
              attributes: { Storage: '128GB' },
              id: 'variant-128',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
          ],
        }}
        variantAxes={['storage']}
        variantCount={1}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 237_674.42, stock: 4 }),
      1,
      expect.objectContaining({
        storage: '128GB',
        variantAttributes: { storage: '128GB' },
        variantId: 'variant-128',
      })
    );
  });

  it('does not scope the default SKU to a stale parent condition', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          condition: 'new',
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              id: 'variant-used-128',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
          ],
        }}
        variantAxes={['storage']}
        variantCount={1}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ condition: 'used', price: 237_674.42 }),
      1,
      expect.objectContaining({
        condition: 'used',
        variantId: 'variant-used-128',
      })
    );
  });

  it('uses the selected multi-condition SKU for price and cart options', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          condition: 'new',
          price: 552_000,
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              id: 'variant-used-128',
              merchant_id: 'merchant-1',
              price_override: 500_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 3,
            },
            {
              attributes: { storage: '128GB' },
              id: 'variant-new-128',
              merchant_id: 'merchant-1',
              price_override: 552_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 5,
            },
          ],
        }}
        variantAxes={['condition', 'storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('500000')).toBeInTheDocument();
    expect(screen.getByText('selected condition:used')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /select new condition/i })
    );

    expect(screen.getByText('552000')).toBeInTheDocument();
    expect(screen.getByText('selected condition:new')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ condition: 'new', price: 552_000, stock: 5 }),
      1,
      expect.objectContaining({
        condition: 'new',
        storage: '128GB',
        variantId: 'variant-new-128',
      })
    );
  });

  it('preserves an explicit route condition before falling back to the lowest-priced default', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          condition: 'new',
          price: 700_000,
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              id: 'variant-used-128',
              merchant_id: 'merchant-1',
              price_override: 500_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 3,
            },
            {
              attributes: { storage: '128GB' },
              condition: 'open_box',
              id: 'variant-open-box-128',
              merchant_id: 'merchant-1',
              price_override: 650_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 5,
            },
          ],
        }}
        initialVariantSelection={{
          attributes: { color: 'Blue' },
          condition: 'open_box',
        }}
        variantAxes={['condition', 'storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('650000')).toBeInTheDocument();
    expect(screen.getByText('selected condition:open_box')).toBeInTheDocument();
  });

  it('treats a top-level route condition as an explicit selector axis and drops pruned ones', () => {
    const product = {
      ...variantCartProduct,
      condition: 'new' as const,
      price: 552_000,
      variants: [
        {
          attributes: { storage: '128GB' },
          condition: 'used' as const,
          id: 'variant-used-128',
          merchant_id: 'merchant-1',
          price_override: 500_000,
          product_id: 'redmi-pad-2',
          stock_quantity: 3,
        },
        {
          attributes: { storage: '256GB' },
          condition: 'new' as const,
          id: 'variant-new-256',
          merchant_id: 'merchant-1',
          price_override: 552_000,
          product_id: 'redmi-pad-2',
          stock_quantity: 5,
        },
      ],
    };

    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={product}
        initialVariantSelection={{ condition: 'used' }}
        variantAxes={['condition', 'storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('selected condition:used')).toBeInTheDocument();
    expect(screen.getByText('explicit axes:condition')).toBeInTheDocument();
    expect(screen.getByText('500000')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /select 256gb storage/i })
    );

    expect(screen.getByText('selected condition:new')).toBeInTheDocument();
    expect(screen.getByText('552000')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(cartMocks.addToCart).not.toHaveBeenCalled();
  });
});

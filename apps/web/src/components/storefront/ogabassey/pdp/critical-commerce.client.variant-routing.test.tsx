import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceClient,
  OgabasseyPdpCriticalCommerceControls,
  OgabasseyPdpCriticalCommerceProvider,
  OgabasseyPdpCriticalCommerceSummary,
} from './critical-commerce.client';

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

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const cartProduct: CartProduct = {
  brand: 'Dell',
  condition: 'used',
  description: 'Dell Alienware m18 R3 (RTX 5080)',
  gtin: '',
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/alienware.avif',
  imageHint: 'Dell Alienware m18 R3 (RTX 5080)',
  imageLarge: 'https://cdn.ogabassey.com/alienware.avif',
  manage_stock: true,
  mpn: 'dell-alienware-m18-r3-rtx-5080',
  name: 'Dell Alienware m18 R3 (RTX 5080)',
  price: 237_674.42,
  status: 'active',
  stock: 4,
};

const variantCartProduct: CartProduct = {
  ...cartProduct,
  has_variants: true,
  variants: [
    {
      attributes: { ram: '4GB', storage: '128GB' },
      id: 'variant-128-4',
      merchant_id: 'merchant-1',
      price_override: 237_674.42,
      product_id: 'product-1',
      stock_quantity: 10,
    },
    {
      attributes: { ram: '8GB', storage: '256GB' },
      id: 'variant-256-8',
      merchant_id: 'merchant-1',
      price_override: 278_418.6,
      product_id: 'product-1',
      stock_quantity: 8,
    },
  ],
};

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
});

describe('OgabasseyPdpCriticalCommerceClient variant routing', () => {
  it('renders selector buttons in native summary content without duplicating them in purchase controls', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={variantCartProduct}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      >
        <div aria-label="Product summary" role="group">
          <OgabasseyPdpCriticalCommerceSummary />
        </div>
        <OgabasseyPdpCriticalCommerceControls
          cartHref="/cart"
          productName={variantCartProduct.name}
        />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    const summarySlotGroup = screen.getByRole('group', {
      name: /product summary/i,
    });
    expect(
      within(summarySlotGroup).getByRole('button', {
        name: /select 128gb storage/i,
      })
    ).toBeInTheDocument();

    const commerceControls = screen.getByRole('group', {
      name: /purchase controls/i,
    });
    expect(
      within(commerceControls).queryByRole('button', {
        name: /select 128gb storage/i,
      })
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(summarySlotGroup).getByRole('button', {
        name: /select 256gb storage/i,
      })
    );
    fireEvent.click(
      within(summarySlotGroup).getByRole('button', {
        name: /select 8gb ram/i,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 278_418.6,
      }),
      1,
      expect.objectContaining({
        variantId: 'variant-256-8',
      })
    );
  });

  it('seeds selectors and the summary price from a valid variant link', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={variantCartProduct}
        initialVariantSelection={{
          attributes: { ram: '8GB', storage: '256GB' },
          variantId: 'variant-256-8',
        }}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      >
        <OgabasseyPdpCriticalCommerceSummary />
        <OgabasseyPdpCriticalCommerceControls
          cartHref="/cart"
          productName={variantCartProduct.name}
        />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(
      screen.getByRole('button', { name: /select 256gb storage/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: /select 8gb ram/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/278,419/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 278_418.6,
      }),
      1,
      expect.objectContaining({
        variantId: 'variant-256-8',
      })
    );
  });

  it('requires an explicit visible color selection before adding color-only variants', () => {
    const colorVariantProduct: CartProduct = {
      ...variantCartProduct,
      variants: [
        {
          attributes: { color: 'Black' },
          id: 'variant-black',
          merchant_id: 'merchant-1',
          price_override: 237_674.42,
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { color: 'Blue' },
          id: 'variant-blue',
          merchant_id: 'merchant-1',
          price_override: 240_000,
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ],
    };

    const { unmount } = render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={colorVariantProduct}
        productName={colorVariantProduct.name}
        variantAxes={[]}
        variantCount={2}
      />
    );

    expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();
    unmount();

    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={colorVariantProduct}
        initialVariantSelection={{
          attributes: { color: 'Blue' },
          variantId: 'variant-blue',
        }}
        productName={colorVariantProduct.name}
        variantAxes={[]}
        variantCount={2}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 240_000,
      }),
      1,
      expect.objectContaining({
        color: 'Blue',
        variantId: 'variant-blue',
      })
    );
  });
});

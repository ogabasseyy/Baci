import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceClient,
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
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
});

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
  price: 7_098_000,
  status: 'active',
  stock: 4,
};

const variantCartProduct: CartProduct = {
  ...cartProduct,
  has_variants: true,
  price: 237_674.42,
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

describe('OgabasseyPdpCriticalCommerceClient', () => {
  it('adds simple products with the selected quantity', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={cartProduct}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(cartProduct, 2, {
      condition: 'used',
    });
    expect(cartMocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('omits the variant hint without renderable selectors and disables decrement at the default quantity', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={cartProduct}
        productName={cartProduct.name}
        variantCount={2}
      />
    );

    expect(
      screen.queryByText('Choose options below before checkout.')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /decrease quantity/i })
    ).toBeDisabled();
  });

  it('adds the selected variant identity, attributes, price, and stock to cart', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={variantCartProduct}
        productName={variantCartProduct.name}
        variantAxes={['storage', 'ram']}
        variantCount={2}
      />
    );

    expect(
      screen.getByRole('button', { name: /select 128gb storage/i })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: /select 256gb storage/i })
    );

    expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /select 8gb ram/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 278_418.6,
        stock: 8,
      }),
      1,
      expect.objectContaining({
        condition: 'used',
        storage: '256GB',
        variantAttributes: {
          ram: '8GB',
          storage: '256GB',
        },
        variantId: 'variant-256-8',
      })
    );
    expect(cartMocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('omits cart condition options when the cart product has no condition', () => {
    const cartProductWithoutCondition = {
      ...cartProduct,
      condition: undefined,
    };

    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={cartProductWithoutCondition}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      cartProductWithoutCondition,
      2,
      undefined
    );
  });

  it('caps quantity increments at managed stock', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={{
          ...cartProduct,
          stock: 2,
        }}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    const increaseButton = screen.getByRole('button', {
      name: /increase quantity/i,
    });
    fireEvent.click(increaseButton);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(increaseButton).toBeDisabled();
  });

  it('blocks cart additions when managed stock is exhausted', () => {
    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={{
          ...cartProduct,
          stock: 0,
        }}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    const increaseButton = screen.getByRole('button', {
      name: /increase quantity/i,
    });
    const addButton = screen.getByRole('button', { name: /add to cart/i });

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(increaseButton).toBeDisabled();
    expect(addButton).toBeDisabled();

    fireEvent.click(increaseButton);
    fireEvent.click(addButton);

    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });

  it('keeps stock-zero products unlimited when stock management is disabled', () => {
    const unmanagedProduct = {
      ...cartProduct,
      manage_stock: false,
      stock: 0,
    };

    render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={unmanagedProduct}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(unmanagedProduct, 2, {
      condition: 'used',
    });
    expect(cartMocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('renders the live summary price in NGN by default', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={cartProduct}
        variantCount={1}
      >
        <OgabasseyPdpCriticalCommerceSummary />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('₦7,098,000')).toBeInTheDocument();
  });

  it('renders the live summary price in the merchant-resolved currency', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={cartProduct}
        currency={{ code: 'GHS', symbol: 'GH₵', locale: 'en-GH' }}
        variantCount={1}
      >
        <OgabasseyPdpCriticalCommerceSummary />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('GH₵7,098,000')).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });

});

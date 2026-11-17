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
  cart: [] as Array<Record<string, unknown>>,
  removeFromCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  updateQuantity: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    removeFromCart: cartMocks.removeFromCart,
    setIsCartOpen: cartMocks.setIsCartOpen,
    updateQuantity: cartMocks.updateQuantity,
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
  cartMocks.removeFromCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.updateQuantity.mockClear();
  cartMocks.cart = [];
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
  it('renders only Add to cart initially and transforms into the In Cart stepper with View cart beside it once in cart', () => {
    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={cartProduct}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    expect(
      screen.queryByRole('link', { name: /view cart/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('In Cart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(cartProduct, 1, {
      condition: 'used',
    });
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();

    cartMocks.cart = [
      {
        cartItemId: 'product-1::condition=used',
        condition: 'used',
        id: 'product-1',
        quantity: 1,
      },
    ];
    rerender(
      <OgabasseyPdpCriticalCommerceClient
        cartHref="/cart"
        cartProduct={cartProduct}
        productName={cartProduct.name}
        variantCount={1}
      />
    );

    expect(
      screen.queryByRole('button', { name: /add to cart/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('In Cart')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view cart/i })).toHaveAttribute(
      'href',
      '/cart'
    );

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    expect(cartMocks.updateQuantity).toHaveBeenCalledWith(
      'product-1::condition=used',
      2,
      undefined
    );

    fireEvent.click(
      screen.getByRole('button', { name: /remove .* from cart/i })
    );
    expect(cartMocks.removeFromCart).toHaveBeenCalledWith(
      'product-1::condition=used',
      undefined
    );
  });

  it('omits the variant hint without renderable selectors', () => {
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

    expect(screen.getByRole('button', { name: /select 8gb ram/i }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled();

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
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      cartProductWithoutCondition,
      1,
      undefined
    );
  });

  it('caps in-cart quantity increments at managed stock', () => {
    cartMocks.cart = [
      {
        cartItemId: 'product-1::condition=used',
        condition: 'used',
        id: 'product-1',
        quantity: 2,
      },
    ];
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
    const decreaseButton = screen.getByRole('button', {
      name: /decrease quantity/i,
    });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(increaseButton).toBeDisabled();

    fireEvent.click(decreaseButton);
    expect(cartMocks.updateQuantity).toHaveBeenCalledWith(
      'product-1::condition=used',
      1,
      undefined
    );
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

    const addButton = screen.getByRole('button', { name: /add to cart/i });
    expect(addButton).toBeDisabled();

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

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(unmanagedProduct, 1, {
      condition: 'used',
    });
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
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

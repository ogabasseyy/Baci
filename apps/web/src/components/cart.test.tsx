import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart/cart-types';
import { Cart } from './cart';

const { mockRemoveFromCart, mockUpdateQuantity, mockUseCart } = vi.hoisted(
  () => ({
    mockRemoveFromCart: vi.fn(),
    mockUpdateQuantity: vi.fn(),
    mockUseCart: vi.fn(),
  })
);

vi.mock('framer-motion', () => {
  const stripMotionProps = <T extends object>(props: T): T => {
    const propsRecord = props as Record<string, unknown>;
    const {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      layout: _layout,
      transition: _transition,
      whileHover: _whileHover,
      whileTap: _whileTap,
      ...rest
    } = propsRecord;
    return rest as T;
  };

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: {
      button: (props: ComponentProps<'button'>) => (
        <button type="button" {...stripMotionProps(props)} />
      ),
      div: (props: ComponentProps<'div'>) => (
        <div {...stripMotionProps(props)} />
      ),
      p: (props: ComponentProps<'p'>) => <p {...stripMotionProps(props)} />,
    },
  };
});

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/themed', () => ({
  ThemedButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  ThemedSheetContent: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/sheet', () => ({
  SheetClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetFooter: ({ children }: { children: ReactNode }) => (
    <footer>{children}</footer>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('./ui/animated-shop-icons', () => ({
  QuantityButton: ({
    disabled,
    onClick,
    type,
  }: {
    disabled?: boolean;
    onClick: () => void;
    type: 'minus' | 'plus';
  }) => (
    <button
      aria-label={type}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {type}
    </button>
  ),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: mockUseCart,
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `₦${amount}`,
  }),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    basePath: '/demo',
  }),
}));

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'product-1',
    cartItemId: 'product-1::variant=variant-128',
    name: 'Legacy Variant',
    description: '',
    status: 'active',
    price: 100,
    quantity: 2,
    manage_stock: true,
    stock: 10,
    image: '/product.jpg',
    imageLarge: '/product.jpg',
    imageHint: '',
    brand: '',
    gtin: '',
    mpn: '',
    variantId: 'variant-128',
    ...overrides,
  } as CartItem;
}

describe('Cart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCart.mockReturnValue({
      cart: [makeCartItem()],
      cartCount: 2,
      cartTotal: 200,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
    });
  });

  it('uses cartItemId for normalized variant line quantity and remove controls', () => {
    render(<Cart />);

    fireEvent.change(screen.getByLabelText('Quantity for Legacy Variant'), {
      target: { value: '3' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Legacy Variant from cart' })
    );

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-1::variant=variant-128',
      3
    );
    expect(mockRemoveFromCart).toHaveBeenCalledWith(
      'product-1::variant=variant-128'
    );
  });

  it('falls back to product and variant ids for legacy cart lines without cartItemId', () => {
    mockUseCart.mockReturnValue({
      cart: [makeCartItem({ cartItemId: undefined })],
      cartCount: 2,
      cartTotal: 200,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
    });

    render(<Cart />);

    fireEvent.change(screen.getByLabelText('Quantity for Legacy Variant'), {
      target: { value: '4' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Legacy Variant from cart' })
    );

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-1',
      4,
      'variant-128'
    );
    expect(mockRemoveFromCart).toHaveBeenCalledWith('product-1', 'variant-128');
  });

  it('renders the empty cart state and polite live region', () => {
    mockUseCart.mockReturnValue({
      cart: [],
      cartCount: 0,
      cartTotal: 0,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
    });

    render(<Cart />);

    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(
      screen.getByText('Add some products to get started!')
    ).toBeInTheDocument();
    expect(screen.getByText('Cart is empty')).toHaveAttribute(
      'aria-live',
      'polite'
    );
    expect(
      screen.queryByRole('link', { name: 'Proceed to Checkout' })
    ).not.toBeInTheDocument();
  });

  it('renders multiple cart lines with distinct ids and the cart total', () => {
    mockUseCart.mockReturnValue({
      cart: [
        makeCartItem({ quantity: 1 }),
        makeCartItem({
          id: 'product-2',
          cartItemId: 'product-2::variant=variant-256',
          name: 'Second Variant',
          price: 50,
          quantity: 3,
          variantId: 'variant-256',
        }),
      ],
      cartCount: 4,
      cartTotal: 250,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
    });

    render(<Cart />);

    expect(screen.getByText('Legacy Variant')).toBeInTheDocument();
    expect(screen.getByText('Second Variant')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('₦250')).toBeInTheDocument();
    expect(
      screen.getByText('Cart updated. 4 items in cart. Subtotal is ₦250.')
    ).toHaveAttribute('aria-live', 'polite');

    fireEvent.change(screen.getByLabelText('Quantity for Second Variant'), {
      target: { value: '2' },
    });

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-2::variant=variant-256',
      2
    );
  });

  it('increments by cartItemId and disables decrement at quantity one', () => {
    mockUseCart.mockReturnValue({
      cart: [makeCartItem({ quantity: 1 })],
      cartCount: 1,
      cartTotal: 100,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
    });

    render(<Cart />);

    const decrementButton = screen.getByRole('button', { name: 'minus' });
    expect(decrementButton).toBeDisabled();

    fireEvent.click(decrementButton);
    expect(mockUpdateQuantity).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'plus' }));

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-1::variant=variant-128',
      2
    );
  });
});

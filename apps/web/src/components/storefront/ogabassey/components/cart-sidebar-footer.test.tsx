import { fireEvent, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('./cart-sidebar-total', () => ({
  CartSidebarTotal: ({ total }: { total: number }) => (
    <div data-testid="cart-total">{total}</div>
  ),
}));

import { CartSidebarFooter } from './cart-sidebar-footer';

function setup(
  overrides: Partial<React.ComponentProps<typeof CartSidebarFooter>> = {}
) {
  const onNegotiateTotal = vi.fn();
  const onCheckout = vi.fn();
  const onClose = vi.fn();
  render(
    <CartSidebarFooter
      total={1000000}
      hasPriceNegotiation
      hasNonNegotiableCartItem={false}
      isCheckoutLoading={false}
      cartHref={'/store/cart' as Route}
      onNegotiateTotal={onNegotiateTotal}
      onCheckout={onCheckout}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onNegotiateTotal, onCheckout, onClose };
}

describe('CartSidebarFooter', () => {
  it('renders the total and checkout actions', () => {
    setup();

    expect(screen.getByTestId('cart-total')).toHaveTextContent('1000000');
    expect(
      screen.getByRole('button', { name: 'Proceed to Checkout' })
    ).toBeEnabled();
    expect(screen.getByRole('link', { name: 'View Full Cart' })).toHaveAttribute(
      'href',
      '/store/cart'
    );
    expect(
      screen.getByRole('button', { name: 'Continue Shopping' })
    ).toBeInTheDocument();
  });

  it('shows the negotiate-total button only when every line is negotiable', () => {
    const { unmount } = render(
      <CartSidebarFooter
        total={0}
        hasPriceNegotiation
        hasNonNegotiableCartItem={false}
        isCheckoutLoading={false}
        cartHref={'/cart' as Route}
        onNegotiateTotal={vi.fn()}
        onCheckout={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Negotiate Total Amount' })
    ).toBeInTheDocument();
    unmount();

    setup({ hasNonNegotiableCartItem: true });
    expect(
      screen.queryByRole('button', { name: 'Negotiate Total Amount' })
    ).not.toBeInTheDocument();
  });

  it('hides the negotiate-total button when negotiation is disabled', () => {
    setup({ hasPriceNegotiation: false });

    expect(
      screen.queryByRole('button', { name: 'Negotiate Total Amount' })
    ).not.toBeInTheDocument();
  });

  it('disables checkout while loading', () => {
    const { onCheckout } = setup({ isCheckoutLoading: true });

    const checkout = screen
      .getAllByRole('button')
      .find((button) => (button as HTMLButtonElement).disabled);
    expect(checkout).toBeDefined();
    // The spinner replaces the checkout label while loading.
    expect(
      screen.queryByRole('button', { name: 'Proceed to Checkout' })
    ).not.toBeInTheDocument();
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('wires the action callbacks', () => {
    const { onNegotiateTotal, onCheckout, onClose } = setup();

    fireEvent.click(
      screen.getByRole('button', { name: 'Negotiate Total Amount' })
    );
    expect(onNegotiateTotal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Proceed to Checkout' }));
    expect(onCheckout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Continue Shopping' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CheckoutLayout from './layout';

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-sans-font">{children}</div>
  ),
}));

vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="cart-provider">{children}</div>
  ),
}));

describe('CheckoutLayout', () => {
  it('wraps checkout routes in CartProvider', () => {
    render(
      <CheckoutLayout>
        <main>Checkout content</main>
      </CheckoutLayout>
    );

    expect(screen.getByTestId('cart-provider')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Checkout content');
  });

  it('applies Inter on root checkout instead of the storefront Arial fallback', () => {
    render(
      <CheckoutLayout>
        <main>Checkout content</main>
      </CheckoutLayout>
    );

    const fontRoot = screen.getByTestId('app-sans-font');
    const cartProvider = screen.getByTestId('cart-provider');

    expect(fontRoot).toContainElement(cartProvider);
    expect(screen.getByRole('main')).toHaveTextContent('Checkout content');
  });
});

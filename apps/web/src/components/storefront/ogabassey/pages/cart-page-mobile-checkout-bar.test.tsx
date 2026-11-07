import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartPageMobileCheckoutBar } from './cart-page-mobile-checkout-bar';

function renderMobileBar(overrides = {}) {
  const props = {
    displayCartTotal: 125_000,
    hasNonNegotiableCartItem: false,
    hasPriceNegotiation: true,
    onCheckoutClick: vi.fn(),
    onOpenTotalNegotiation: vi.fn(),
    ...overrides,
  };

  render(<CartPageMobileCheckoutBar {...props} />);

  return props;
}

describe('CartPageMobileCheckoutBar', () => {
  it('wires mobile negotiation and checkout actions', () => {
    const props = renderMobileBar();

    fireEvent.click(screen.getByRole('button', { name: /bulk negotiate/i }));
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));

    expect(props.onOpenTotalNegotiation).toHaveBeenCalledTimes(1);
    expect(props.onCheckoutClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('₦125,000')).toBeInTheDocument();
  });

  it('hides total negotiation when the cart includes non-negotiable items', () => {
    renderMobileBar({ hasNonNegotiableCartItem: true });

    expect(
      screen.queryByRole('button', { name: /bulk negotiate/i })
    ).not.toBeInTheDocument();
  });
});

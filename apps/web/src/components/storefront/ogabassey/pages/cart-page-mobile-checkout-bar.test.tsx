import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartPageMobileCheckoutBar } from './cart-page-mobile-checkout-bar';

const CLEARANCE = '--cw-bubble-bottom-clearance';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(CLEARANCE);
});

function renderMobileBar(overrides = {}) {
  const props = {
    displayCartTotal: 125_000,
    hasNonNegotiableCartItem: false,
    hasPriceNegotiation: true,
    onCheckoutClick: vi.fn(),
    onOpenTotalNegotiation: vi.fn(),
    ...overrides,
  };

  const view = render(<CartPageMobileCheckoutBar {...props} />);

  return { ...props, ...view };
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

  it('lifts the Chatwoot launcher above the bar while it shows', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 176,
      width: 375,
      height: 80,
    } as DOMRect);
    const { unmount } = renderMobileBar();

    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe(
      '164px'
    );
    unmount();
    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('');
  });

  it('hides total negotiation when the cart includes non-negotiable items', () => {
    renderMobileBar({ hasNonNegotiableCartItem: true });

    expect(
      screen.queryByRole('button', { name: /bulk negotiate/i })
    ).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualQaControls } from './ManualQaControls';

const originalLocation = window.location;
const reload = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: reset the isolated scenario fixture between component tests
  document.cookie = 'checkout-qa-scenario=; Max-Age=0; path=/';
  reload.mockReset();
  assign.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

function setLocation(search: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, search, reload, assign },
  });
}

describe('ManualQaControls', () => {
  it('stays hidden unless manual QA mode is explicitly enabled', () => {
    setLocation('');
    render(<ManualQaControls />);

    expect(
      screen.queryByRole('complementary', {
        name: 'Manual checkout QA fixtures',
      })
    ).not.toBeInTheDocument();
  });

  it('persists the selected provider scenario and reloads the fixture', () => {
    setLocation('?qa=manual');
    render(<ManualQaControls />);

    expect(
      screen.getByRole('complementary', {
        name: 'Manual checkout QA fixtures',
      })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment scenario'), {
      target: { value: 'provider-error' },
    });

    expect(document.cookie).toContain('checkout-qa-scenario=provider-error');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('clears the seeded cart, form, pending order, and idempotency key on reset', () => {
    setLocation('?qa=manual');
    localStorage.setItem('baci-cart-ogabassey-guest', '[{"id":"fixture"}]');
    localStorage.setItem('storefront-checkout-idempotency', 'fixture-key');
    sessionStorage.setItem('checkout-form', '{"firstName":"Ada"}');
    sessionStorage.setItem(
      'storefront-checkout-pending-order',
      '{"orderId":"fixture-order"}'
    );
    render(<ManualQaControls />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset checkout fixtures' })
    );

    expect(localStorage.getItem('baci-cart-ogabassey-guest')).toBeNull();
    expect(localStorage.getItem('storefront-checkout-idempotency')).toBeNull();
    expect(sessionStorage.getItem('checkout-form')).toBeNull();
    expect(
      sessionStorage.getItem('storefront-checkout-pending-order')
    ).toBeNull();
    expect(document.cookie).toContain('checkout-qa-scenario=success');
    expect(assign).toHaveBeenCalledWith('/cart?qaReset=1&qa=manual');
  });
});

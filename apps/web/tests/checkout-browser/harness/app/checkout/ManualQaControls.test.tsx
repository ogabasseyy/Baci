import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualQaControls } from './ManualQaControls';

const reload = vi.fn();
const assign = vi.fn();
const navigation = { reload, assign };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: reset the isolated scenario fixture between component tests
  document.cookie = 'checkout-qa-scenario=; Max-Age=0; path=/';
  // biome-ignore lint/suspicious/noDocumentCookie: clear fixture identity between component tests
  document.cookie = 'checkout-qa-customer-email=; Max-Age=0; path=/';
  reload.mockReset();
  assign.mockReset();
});

function setLocation(search: string) {
  window.history.replaceState({}, '', search || '/');
}

describe('ManualQaControls', () => {
  it('stays hidden unless manual QA mode is explicitly enabled', () => {
    setLocation('');
    render(<ManualQaControls navigation={navigation} />);

    expect(
      screen.queryByRole('complementary', {
        name: 'Manual checkout QA fixtures',
      })
    ).not.toBeInTheDocument();
  });

  it('persists the selected provider scenario and reloads the fixture', () => {
    setLocation('?qa=manual');
    render(<ManualQaControls navigation={navigation} />);

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

  it('clears seeded checkout and synthetic customer identity on reset', () => {
    setLocation('?qa=manual');
    localStorage.setItem('baci-cart-ogabassey-guest', '[{"id":"fixture"}]');
    localStorage.setItem('storefront-checkout-idempotency', 'fixture-key');
    // biome-ignore lint/suspicious/noDocumentCookie: seed local fixture identity for reset assertion
    document.cookie = 'checkout-qa-customer-email=ada%40example.test; path=/';
    sessionStorage.setItem('checkout-form', '{"firstName":"Ada"}');
    sessionStorage.setItem(
      'storefront-checkout-pending-order',
      '{"orderId":"fixture-order"}'
    );
    render(<ManualQaControls navigation={navigation} />);

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
    expect(document.cookie).not.toContain('checkout-qa-customer-email=');
    expect(assign).toHaveBeenCalledWith('/cart?qaReset=1&qa=manual');
  });
});

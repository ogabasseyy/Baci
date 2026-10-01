import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Cart from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    cart: [{ cartItemId: 'fixture-item', name: 'Checkout fixture phone' }],
  }),
}));

const storageKeys = {
  cart: 'baci-cart-ogabassey-guest',
  form: 'checkout-form',
  pending: 'storefront-checkout-pending-order',
  idempotency: 'storefront-checkout-idempotency',
} as const;

function seedStorage() {
  localStorage.setItem(storageKeys.cart, '[{"id":"fixture-item"}]');
  sessionStorage.setItem(storageKeys.form, '{"firstName":"Ada"}');
  sessionStorage.setItem(storageKeys.pending, '{"orderId":"fixture-order"}');
  localStorage.setItem(storageKeys.idempotency, 'fixture-key');
}

function expectStorageCleared() {
  expect(localStorage.getItem(storageKeys.cart)).toBeNull();
  expect(sessionStorage.getItem(storageKeys.form)).toBeNull();
  expect(sessionStorage.getItem(storageKeys.pending)).toBeNull();
  expect(localStorage.getItem(storageKeys.idempotency)).toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/cart');
});

describe('fixture cart page', () => {
  it('preserves seeded checkout state during ordinary navigation', async () => {
    seedStorage();
    render(<Cart />);

    expect(
      await screen.findByRole('link', { name: 'Proceed to checkout' })
    ).toHaveAttribute('href', '/checkout');
    expect(screen.getByText('Checkout fixture phone')).toBeInTheDocument();
    expect(localStorage.getItem(storageKeys.cart)).not.toBeNull();
    expect(sessionStorage.getItem(storageKeys.form)).not.toBeNull();
    expect(sessionStorage.getItem(storageKeys.pending)).not.toBeNull();
    expect(localStorage.getItem(storageKeys.idempotency)).not.toBeNull();
  });

  it('propagates the explicit manual QA query to checkout without clearing state', async () => {
    seedStorage();
    window.history.replaceState({}, '', '/cart?qa=manual');
    render(<Cart />);

    expect(
      await screen.findByRole('link', { name: 'Proceed to checkout' })
    ).toHaveAttribute('href', '/checkout?qa=manual');
    expect(localStorage.getItem(storageKeys.cart)).not.toBeNull();
    expect(sessionStorage.getItem(storageKeys.form)).not.toBeNull();
    expect(sessionStorage.getItem(storageKeys.pending)).not.toBeNull();
    expect(localStorage.getItem(storageKeys.idempotency)).not.toBeNull();
  });

  it('clears every checkout fixture key immediately and after deferred cleanup', async () => {
    vi.useFakeTimers();
    try {
      seedStorage();
      window.history.replaceState({}, '', '/cart?qaReset=1&qa=manual');
      render(<Cart />);
      expectStorageCleared();
      expect(window.location.search).toBe('?qa=manual');

      seedStorage();
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      expectStorageCleared();
    } finally {
      vi.useRealTimers();
    }
  });
});

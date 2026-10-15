import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { clearCartStorage } from '@/hooks/cart/cart-persistence';
import { CartAccountLink } from './cart-account-link';

vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => ({
    isAuthenticated: true,
    user: { id: 'user' },
  }),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    sharedCartAccountsEnabled: true,
    sharedCartEnabled: true,
    sharedCartRef: { cartId: 'old', version: 10 },
    syncStatus: 'synced',
  }),
}));
vi.mock('@/hooks/cart/cart-persistence', () => ({ clearCartStorage: vi.fn() }));
const accountState = vi.hoisted(() => ({
  savedCart: null as unknown,
  link: vi.fn(),
}));
vi.mock('@/hooks/cart/shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('@/hooks/cart/use-cart-account-link', () => ({
  useCartAccountLink: (options: { onLinked: () => void }) => ({
    link: async (...args: unknown[]) => {
      accountState.link(...args);
      options.onLinked();
      return true;
    },
    loadSavedCart: vi.fn(),
    savedCart: accountState.savedCart,
    status: 'ready',
    pending: false,
    retry: vi.fn(),
  }),
}));
it('starts a fresh local adoption after account selection instead of comparing versions across different carts', async () => {
  render(<CartAccountLink merchantSlug="shop" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save this cart to my account' })
  );
  await waitFor(() => expect(clearCartStorage).toHaveBeenCalledWith('shop'));
});

it('keeps saved and current offer labels aligned with the merge destination', async () => {
  const { fetchSharedCartSnapshot } = await import(
    '@/hooks/cart/shared-cart-client'
  );
  const base = {
    currency: 'NGN',
    merchantId: 'm',
    version: 1,
    state: 'active',
    subtotalMinor: 100,
    totalMinor: 100,
    estimatedTotals: false,
    expiresAt: '2030-01-01',
    lines: [
      {
        id: 'saved-line',
        item: { productId: 'product' },
        quantity: 1,
        unitPriceMinor: 100,
        lineTotalMinor: 100,
        voucherToken: 'saved',
      },
    ],
  };
  accountState.savedCart = { ...base, cartId: 'saved' };
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: {
      ...base,
      cartId: 'old',
      lines: [
        { ...base.lines[0], id: 'current-line', voucherToken: 'current' },
      ],
    },
    warnings: [],
  } as never);
  render(<CartAccountLink merchantSlug="shop" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Review combining both carts' })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Keep saved offer' })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Combine both carts' })
  );
  expect(accountState.link).toHaveBeenLastCalledWith(
    'merge',
    expect.objectContaining({
      resolutions: [{ item: { productId: 'product' }, keep: 'incoming' }],
    })
  );
});

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
vi.mock('@/hooks/cart/use-cart-account-link', () => ({
  useCartAccountLink: (options: { onLinked: () => void }) => ({
    link: async () => {
      options.onLinked();
      return true;
    },
    loadSavedCart: vi.fn(),
    savedCart: null,
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

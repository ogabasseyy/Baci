import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearCartStorage } from '@/hooks/cart/cart-persistence';
import { CartAccountLink } from './cart-account-link';

const authState = vi.hoisted(() => ({ userId: 'user' }));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => ({
    isAuthenticated: true,
    user: { id: authState.userId },
  }),
}));
const cartState = vi.hoisted(() => ({
  sharedCartRef: { cartId: 'old', version: 10 } as {
    cartId: string;
    version: number;
  } | null,
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    sharedCartAccountsEnabled: true,
    sharedCartEnabled: true,
    sharedCartRef: cartState.sharedCartRef,
    syncStatus: 'synced',
  }),
}));
vi.mock('@/hooks/cart/cart-persistence', () => ({ clearCartStorage: vi.fn() }));
const accountState = vi.hoisted(() => ({
  savedCart: null as unknown,
  loaded: true,
  scopeKey: 'initial',
  status: 'ready',
  load: vi.fn(),
  link: vi.fn(),
}));
const mockBootstrap = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/hooks/cart/shared-cart-client', () => ({
  bootstrapSharedCart: mockBootstrap,
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('@/hooks/cart/use-cart-account-link', () => ({
  useCartAccountLink: (options: { onLinked: () => void }) => ({
    link: async (...args: unknown[]) => {
      accountState.link(...args);
      options.onLinked();
      return true;
    },
    loadSavedCart: accountState.load,
    savedCart: accountState.savedCart,
    savedCartLoaded: accountState.loaded,
    scopeKey: accountState.scopeKey,
    status: accountState.status,
    pending: false,
    retry: vi.fn(),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  cartState.sharedCartRef = { cartId: 'old', version: 10 };
  authState.userId = 'user';
  accountState.savedCart = null;
  accountState.loaded = true;
  accountState.scopeKey = 'initial';
  accountState.status = 'ready';
});
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

it.each([
  'loading',
  'error',
])('blocks choices while saved-cart state is %s and exposes read retry after failure', (status) => {
  accountState.loaded = false;
  accountState.status = status;
  render(<CartAccountLink merchantSlug="shop" />);
  expect(
    screen.getByRole('button', { name: 'Save this cart to my account' })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save this cart to my account' })
  );
  expect(accountState.link).not.toHaveBeenCalled();
  if (status === 'error') {
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading saved cart' })
    );
    expect(accountState.load).toHaveBeenCalledTimes(2);
  }
});

it.each([
  'merchant',
  'shopper',
])('reloads saved-cart knowledge when the %s changes even though the loader is stable', (change) => {
  const { rerender } = render(<CartAccountLink merchantSlug="shop" />);
  expect(accountState.load).toHaveBeenCalledTimes(1);
  if (change === 'shopper') authState.userId = 'another-user';
  rerender(
    <CartAccountLink
      merchantSlug={change === 'merchant' ? 'another-shop' : 'shop'}
    />
  );
  expect(accountState.load).toHaveBeenCalledTimes(2);
});

it('reloads after the hook reports a new cart generation with unchanged merchant and shopper', () => {
  const { rerender } = render(<CartAccountLink merchantSlug="shop" />);
  expect(accountState.load).toHaveBeenCalledTimes(1);
  accountState.scopeKey = 'after-link-generation';
  accountState.loaded = false;
  accountState.status = 'idle';
  rerender(<CartAccountLink merchantSlug="shop" />);
  expect(accountState.load).toHaveBeenCalledTimes(2);
});

it('offers saved-cart adoption before a current cart exists', async () => {
  cartState.sharedCartRef = null;
  accountState.savedCart = {
    cartId: 'saved',
    currency: 'NGN',
    merchantId: 'm',
    version: 2,
    state: 'active',
    subtotalMinor: 500,
    totalMinor: 500,
    estimatedTotals: false,
    expiresAt: '2030-01-01',
    lines: [],
  };
  render(<CartAccountLink merchantSlug="shop" />);
  const useSaved = await screen.findByRole('button', {
    name: 'Use saved cart',
  });
  expect(
    screen.queryByRole('button', { name: 'Save this cart to my account' })
  ).toBeNull();
  expect(mockBootstrap).toHaveBeenCalledWith('shop');
  fireEvent.click(useSaved);
  await waitFor(() =>
    expect(accountState.link).toHaveBeenCalledWith('use_saved')
  );
});

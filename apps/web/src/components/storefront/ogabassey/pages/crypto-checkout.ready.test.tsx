import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoCheckoutPage } from './crypto-checkout';

const mocks = vi.hoisted(() => ({
  state: { searchParams: new URLSearchParams(), isReady: true },
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-private-search-params', () => ({
  usePrivateSearchParamsState: () => mocks.state,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1', slug: 'shop' },
    loading: false,
  }),
}));

describe('bugfix: reloaded crypto checkout link showed missing-order error before the stash was readable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReturnValue(new Promise(() => undefined));
    global.fetch = mocks.fetch as unknown as typeof fetch;
  });

  it('shows no error and starts no payment while not ready, then initialises once', async () => {
    mocks.state = { searchParams: new URLSearchParams(), isReady: false };
    const { rerender } = render(<CryptoCheckoutPage />);

    expect(screen.queryByText(/missing order id or amount/i)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.state = {
      searchParams: new URLSearchParams({ orderId: 'o-1', amount: '5000' }),
      isReady: true,
    };
    rerender(<CryptoCheckoutPage />);

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  });
});

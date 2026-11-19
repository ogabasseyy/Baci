import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoCheckoutPage } from './crypto-checkout';

const mocks = vi.hoisted(() => ({
  state: {
    searchParams: new URLSearchParams({
      orderId: 'o-1',
      amount: '5000',
      customer_email: 'a@b.c',
    }),
    isReady: true,
  },
  fetch: vi.fn(),
  reload: vi.fn(),
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

describe('bugfix: Try Again reloaded the page and lost memory-only customer details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', mocks.fetch);
    vi.stubGlobal('location', { ...window.location, reload: mocks.reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries the initialization in place with the same customer details', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ error: 'Busy' }, { status: 503 }))
      .mockReturnValueOnce(new Promise(() => undefined));
    render(<CryptoCheckoutPage />);
    await screen.findByText('Busy');

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.reload).not.toHaveBeenCalled();
    const body = JSON.parse(String(mocks.fetch.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ order_id: 'o-1', customer_email: 'a@b.c' });
  });
});

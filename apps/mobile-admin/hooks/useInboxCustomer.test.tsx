import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/lib/merchant-inbox-api', () => ({
  fetchInboxCustomer: mocks.fetch,
}));

import { useInboxCustomer } from './useInboxCustomer';

const profile = {
  name: 'Ada Obi',
  currency: 'NGN',
  memberSince: null,
  orderCount: 2,
  totalSpent: 100,
  loyaltyPoints: 0,
  recentOrders: [],
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useInboxCustomer', () => {
  it('loads the customer behind the chat', async () => {
    mocks.fetch.mockResolvedValue(profile);
    const { result } = renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(profile));
    expect(mocks.fetch).toHaveBeenCalledWith(9);
  });

  it('reports no customer for a guest chat', async () => {
    mocks.fetch.mockResolvedValue(null);
    const { result } = renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not ask until the merchant is known', async () => {
    renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: undefined }),
      { wrapper }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('keeps one cache entry per merchant and chat', async () => {
    mocks.fetch.mockResolvedValue(profile);
    const first = renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );
    await waitFor(() => expect(first.result.current.data).toEqual(profile));

    mocks.fetch.mockResolvedValue({ ...profile, name: 'Bo Okafor' });
    const other = renderHook(
      () => useInboxCustomer({ conversationId: 10, merchantId: 'm1' }),
      { wrapper }
    );
    await waitFor(() =>
      expect(other.result.current.data?.name).toBe('Bo Okafor')
    );
    expect(first.result.current.data?.name).toBe('Ada Obi');
    expect(
      client.getQueryCache().findAll({ queryKey: ['inbox-customer'] })
    ).toHaveLength(2);
  });

  it('reports an error when the lookup fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('down'));
    const { result } = renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('bugfix: follows the shopper while the chat stays open', async () => {
    mocks.fetch.mockResolvedValueOnce(null).mockResolvedValue(profile);
    const { result } = renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();

    // The shopper signs in: a refresh (the poll, or any invalidation of the
    // chat's queries) brings the card in without reopening the conversation.
    await client.invalidateQueries({ queryKey: ['inbox-customer', 'm1', 9] });
    await waitFor(() => expect(result.current.data).toEqual(profile));
  });

  it('polls on a timer so an open chat does not stay stale', () => {
    mocks.fetch.mockResolvedValue(profile);
    renderHook(
      () => useInboxCustomer({ conversationId: 9, merchantId: 'm1' }),
      { wrapper }
    );
    const [query] = client
      .getQueryCache()
      .findAll({ queryKey: ['inbox-customer', 'm1', 9] });
    expect(
      (query.options as { refetchInterval?: number }).refetchInterval
    ).toBe(30_000);
  });
});

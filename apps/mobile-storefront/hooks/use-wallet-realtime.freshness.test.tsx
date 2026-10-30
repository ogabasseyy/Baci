import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useWalletRealtime } from './use-wallet-realtime';
import { walletKeys } from './wallet-query';

const handlers: Record<string, (payload: unknown) => void> = {};
const mockNumbers = jest.fn();
jest.mock('./wallet-number-data', () => ({
  fetchWalletNumbers: (...args: unknown[]) => mockNumbers(...args),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (
          _type: string,
          config: { table: string },
          callback: (payload: unknown) => void
        ) => {
          handlers[config.table] = callback;
          return channel;
        },
        subscribe: jest.fn(),
      };
      return channel;
    },
    removeChannel: jest.fn(),
  },
}));

it('clears a failed realtime refresh after the same wallet is refreshed without making old metadata fresh', async () => {
  jest.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const key = walletKeys.data({
    merchantId: 'merchant',
    ownerId: 'customer',
    userId: 'user',
  });
  const cached = {
    walletId: 'wallet',
    wallet: { balance: 10, funding_account: { account_number: '123' } },
    transactions: [],
  };
  client.setQueryData(key, cached, { updatedAt: 123 });
  mockNumbers.mockReset().mockRejectedValue(new Error('Offline'));
  jest
    .spyOn(client, 'invalidateQueries')
    .mockRejectedValue(new Error('Offline'));
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () =>
      useWalletRealtime({
        key,
        merchantId: 'merchant',
        customerId: 'customer',
        userId: 'user',
        enabled: true,
        numbersOnly: true,
        walletId: 'wallet',
        updatedAt: 123,
      }),
    { wrapper }
  );

  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: { id: 'wallet', merchant_id: 'merchant', customer_id: 'customer' },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  const otherKey = walletKeys.data({
    merchantId: 'merchant',
    ownerId: 'other',
    userId: 'other-user',
  });
  act(() => client.setQueryData(otherKey, cached));
  expect(result.current.isError).toBe(true);

  act(() =>
    client.setQueryData(
      key,
      { ...cached, wallet: { ...cached.wallet, balance: 20 } },
      { updatedAt: 123 }
    )
  );
  await waitFor(() => expect(result.current.isError).toBe(false));
  expect(client.getQueryState(key)?.dataUpdatedAt).toBe(123);
  unmount();
  client.clear();
  jest.useRealTimers();
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useWalletRealtime } from './use-wallet-realtime';
import { walletKeys } from './wallet-query';

const handlers: Record<string, (payload?: unknown) => void> = {};
const mockRemove = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (
          _event: string,
          config: { table: string },
          callback: () => void
        ) => {
          handlers[config.table] = callback;
          return channel;
        },
        subscribe: jest.fn(),
      };
      return channel;
    },
    removeChannel: (...args: unknown[]) => mockRemove(...args),
  },
}));

it('combines structural changes into one full refresh and removes the channel on disposal', async () => {
  jest.useFakeTimers();
  const client = new QueryClient();
  const key = walletKeys.data({
    merchantId: 'merchant',
    ownerId: 'customer',
    userId: 'user',
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { unmount } = renderHook(
    () =>
      useWalletRealtime({
        customerId: 'customer',
        merchantId: 'merchant',
        userId: 'user',
        key,
        numbersOnly: false,
        enabled: true,
      }),
    { wrapper }
  );
  act(() => {
    handlers.customer_savings_goals();
    handlers.customers();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  unmount();
  expect(mockRemove).toHaveBeenCalledTimes(1);
  client.clear();
  jest.useRealTimers();
});

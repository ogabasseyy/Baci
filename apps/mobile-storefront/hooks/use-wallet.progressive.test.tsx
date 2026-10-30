import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { piggyvestPrimaryWalletApi as api } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { usePiggyvestWalletSetup } from './use-piggyvest-wallet-setup';
import { useWallet } from './use-wallet';
import { walletKeys } from './wallet-query';

const mockProducts = jest.fn();
const mockTransactions = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = {
        data:
          table === 'customers'
            ? [{ id: 'customer', loyalty_points: 10 }]
            : table === 'customer_wallets'
              ? { id: 'wallet', available_balance: 100 }
              : table === 'customer_savings_goals'
                ? []
                : null,
        error: null,
      };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        limit: () => Promise.resolve(result),
      };
      return query;
    },
    channel: () => {
      const channel = { on: () => channel, subscribe: jest.fn() };
      return channel;
    },
    removeChannel: jest.fn(),
  },
}));
jest.mock('./wallet-savings-product-hydration', () => ({
  hydrateWalletSavingsProducts: (...args: unknown[]) => mockProducts(...args),
}));
jest.mock('./wallet-transaction-data', () => ({
  fetchWalletTransactions: (...args: unknown[]) => mockTransactions(...args),
}));
jest.mock('./wallet-savings-interest', () => ({
  fetchWalletSavingsInterest: async () => ({
    status: 'available',
    creditedInterestKobo: 733,
    goalInterestKobo: [],
  }),
  toWalletSavingsInterestEarnings: () => ({
    earnings_available: true,
    earnings_balance: 7.33,
  }),
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant' } }));
jest.mock('@/lib/wallet-funding-account', () => ({
  createWalletFundingAccount: jest.fn(),
}));
jest.mock('./use-redeem-points', () => ({ useRedeemPoints: jest.fn() }));
jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return {
    useAuthStore: create(() => ({
      customer: { id: 'customer', user_id: 'user' },
      merchantId: 'merchant',
      user: { id: 'user' },
    })),
  };
});
const ready = {
  account: {
    accountNumber: '9000000012',
    accountName: 'Test',
    bankName: 'Sandbox',
    provider: 'piggyvest' as const,
  },
  provisioningStatus: 'ready' as const,
  requiresConsent: false,
};
const credit = {
  id: 'credit',
  type: 'credit',
  amount: 100,
  source_type: 'wallet_topup',
  description: 'Bank transfer',
  created_at: '2026-10-12T10:00:00Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'user' } as NonNullable<
      ReturnType<typeof useAuthStore.getState>['user']
    >,
  });
  mockProducts.mockResolvedValue(new Map());
  mockTransactions.mockResolvedValue([credit]);
  jest.mocked(api.read).mockResolvedValue(ready);
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useWallet({
        cachePolicy: 'display',
        navigationRefresh: 'numbers',
        progressive: true,
      }),
    { wrapper }
  );
  return {
    ...hook,
    client,
    wrapper,
    cleanup: () => {
      hook.unmount();
      client.clear();
    },
  };
}
it('renders money first without making partial data available to payment consumers, then shares the verified account', async () => {
  const primary = deferred<typeof ready>();
  const products = deferred<Map<string, never>>();
  const history = deferred<(typeof credit)[]>();
  jest.mocked(api.read).mockReturnValue(primary.promise);
  mockProducts.mockReturnValue(products.promise);
  mockTransactions.mockReturnValue(history.promise);
  const { result, client, wrapper, cleanup } = setup();
  await waitFor(() =>
    expect(result.current.balancePreview?.total_balance).toBe(100)
  );
  expect(result.current.balancePreview?.earnings_balance).toBe(7.33);
  expect(result.current.data).toBeUndefined();
  expect(
    client.getQueryData(
      walletKeys.data({
        merchantId: 'merchant',
        ownerId: 'customer',
        userId: 'user',
      })
    )
  ).toBeUndefined();
  const recovery = renderHook(
    () => usePiggyvestWalletSetup('merchant', 'user'),
    { wrapper }
  );
  await act(async () => {
    primary.resolve(ready);
    products.resolve(new Map<string, never>());
    history.resolve([credit]);
  });
  await waitFor(() =>
    expect(result.current.data?.wallet.funding_account?.account_number).toBe(
      '9000000012'
    )
  );
  expect(result.current.data?.transactions).toEqual([credit]);
  expect(recovery.result.current.account).toEqual(ready.account);
  expect(api.read).toHaveBeenCalledTimes(1);
  recovery.unmount();
  cleanup();
});
it('drops a previous customer balance preview while an account switch is unresolved', async () => {
  const primary = deferred<typeof ready>();
  jest.mocked(api.read).mockReturnValue(primary.promise);
  const { result, rerender, cleanup } = setup();
  await waitFor(() =>
    expect(result.current.balancePreview?.total_balance).toBe(100)
  );
  act(() =>
    useAuthStore.setState({
      user: { id: 'other' } as NonNullable<
        ReturnType<typeof useAuthStore.getState>['user']
      >,
    })
  );
  rerender({});
  expect(result.current.balancePreview).toBeUndefined();
  expect(result.current.data).toBeUndefined();
  await act(async () => primary.resolve(ready));
  expect(result.current.balancePreview).toBeUndefined();
  cleanup();
});

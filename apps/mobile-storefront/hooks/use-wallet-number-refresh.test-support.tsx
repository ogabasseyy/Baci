import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useWalletNumberRefresh } from './use-wallet-number-refresh';
import { type WalletQueryData, walletKeys } from './wallet-query';

const mockNumbers = jest.fn();
const mockHistory = jest.fn();
jest.mock('./wallet-number-data', () => ({
  fetchWalletNumbers: (...args: unknown[]) => mockNumbers(...args),
}));
jest.mock('./wallet-transaction-data', () => ({
  fetchWalletTransactions: (...args: unknown[]) => mockHistory(...args),
}));
const key = walletKeys.data({
  merchantId: 'merchant-1',
  ownerId: 'customer-1',
  userId: 'user-1',
});
const cached: WalletQueryData = {
  walletId: 'wallet-1',
  wallet: {
    balance: 0,
    loyalty_points: 0,
    savings_balance: 200,
    total_balance: 200,
    savings_goals: [],
    active_savings_goal: null,
    funding_account: {
      provider: 'piggyvest',
      account_name: 'Test',
      account_number: '1234567890',
      bank_name: 'Sandbox',
    },
  },
  transactions: [],
};
const fresh = {
  wallet: {
    balance: 100,
    savings_balance: 200,
    total_balance: 300,
    loyalty_points: 10,
  },
  goals: [],
};
function reset() {
  mockNumbers.mockReset().mockResolvedValue(fresh);
  mockHistory.mockReset().mockResolvedValue([]);
}
function setup(includeTransactions = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, cached, { updatedAt: 123 });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useWalletNumberRefresh(), { wrapper });
  const request = {
    includeTransactions,
    customerId: 'customer-1',
    merchantId: 'merchant-1',
    userId: 'user-1',
    isCurrent: jest.fn(() => true),
    refetchFull: jest.fn(async (): Promise<unknown> => undefined),
  };
  return {
    ...hook,
    client,
    request,
    cleanup: () => {
      hook.unmount();
      client.clear();
    },
  };
}

export const walletNumberRefreshTestFixture = {
  mockNumbers,
  mockHistory,
  key,
  cached,
  fresh,
  setup,
  reset,
};

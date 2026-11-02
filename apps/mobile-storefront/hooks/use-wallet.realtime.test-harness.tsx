import { afterEach, beforeEach, jest } from '@jest/globals';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { type WalletQueryData, walletKeys } from './wallet-query';

type TestMock = {
  mockResolvedValue(value: unknown): unknown;
};

const key = walletKeys.data({
  merchantId: 'merchant-1',
  ownerId: 'customer-1',
  userId: 'user-1',
});

const saved: WalletQueryData = {
  walletId: 'wallet-1',
  wallet: {
    balance: 0,
    loyalty_points: 0,
    savings_balance: 200,
    total_balance: 200,
    savings_goals: [],
    active_savings_goal: null,
    funding_account: {
      account_name: 'Test',
      account_number: '1234567890',
      bank_name: 'Sandbox',
      provider: 'piggyvest',
    },
  },
  transactions: [],
};

const credit = {
  id: 'credit-1',
  type: 'credit',
  amount: 100,
  description: 'Bank transfer',
  created_at: '2026-10-12T10:00:00Z',
  source_type: 'wallet_topup',
};

export function createWalletRealtimeTestHarness({
  handlers,
  mockFull,
  mockNumbers,
  mockHistory,
}: {
  handlers: Record<string, (payload: unknown) => void>;
  mockFull: TestMock;
  mockNumbers: TestMock;
  mockHistory: TestMock;
}) {
  beforeEach(() => {
    useAuthStore.setState({ merchantId: 'merchant-1' });
    onlineManager.setOnline(true);
    jest.useFakeTimers();
    jest.clearAllMocks();
    for (const table of Object.keys(handlers)) delete handlers[table];
    mockFull.mockResolvedValue(saved);
    mockNumbers.mockResolvedValue({
      wallet: {
        balance: 100,
        total_balance: 300,
        savings_balance: 200,
        loyalty_points: 0,
      },
      goals: [],
    });
    mockHistory.mockResolvedValue([credit]);
  });

  afterEach(() => {
    jest.useRealTimers();
    onlineManager.setOnline(true);
  });

  function setup(cached = true) {
    const { useWallet } =
      require('./use-wallet') as typeof import('./use-wallet');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (cached) client.setQueryData(key, saved);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () => useWallet({ cachePolicy: 'display', navigationRefresh: 'numbers' }),
      { wrapper }
    );
    return {
      ...hook,
      client,
      cleanup: () => {
        hook.unmount();
        client.clear();
      },
    };
  }

  return { credit, key, saved, setup, walletKeys };
}

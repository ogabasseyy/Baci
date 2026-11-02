import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useWallet } from './use-wallet';
import { walletGoalMetadata } from './wallet-goal-metadata';
import { type WalletQueryData, walletKeys } from './wallet-query';

const mockFull = jest.fn();
const mockNumbers = jest.fn();
const mockHistory = jest.fn();
const handlers: Record<string, (payload: unknown) => void> = {};
jest.mock('./wallet-data', () => ({
  fetchWalletData: (...args: unknown[]) => mockFull(...args),
}));
jest.mock('./wallet-number-data', () => ({
  fetchWalletNumbers: (...args: unknown[]) => mockNumbers(...args),
}));
jest.mock('./wallet-transaction-data', () => ({
  fetchWalletTransactions: (...args: unknown[]) => mockHistory(...args),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (
          _event: string,
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
const goal = {
  id: 'goal',
  title: 'Phone',
  product_id: 'phone',
  variant_id: null,
  product_snapshot: null,
  target_amount: 1000,
  current_amount: 200,
  contribution_amount: 100,
  contribution_frequency: 'monthly' as const,
  source_mode: 'manual' as const,
  status: 'active' as const,
  maturity_date: '2026-11-12',
  product_image: 'phone.jpg',
};
const cached: WalletQueryData = {
  walletId: 'wallet',
  goalMetadata: { goal: walletGoalMetadata(goal) ?? '' },
  wallet: {
    balance: 0,
    loyalty_points: 0,
    savings_balance: 200,
    total_balance: 200,
    funding_account: {
      provider: 'piggyvest',
      account_name: 'Test',
      account_number: '9000000012',
      bank_name: 'Sandbox',
    },
    active_savings_goal: goal,
    savings_goals: [goal],
  },
  transactions: [],
};
const credit = {
  id: 'credit',
  type: 'credit' as const,
  amount: 100,
  description: 'Bank transfer',
  created_at: '2026-10-12T10:00:00Z',
  source_type: 'wallet_topup',
};
const debit = {
  id: 'debit',
  type: 'debit' as const,
  amount: 100,
  description: 'Savings contribution',
  created_at: '2026-10-12T10:01:00Z',
  source_type: 'savings_contribution',
};
it('updates a confirmed bank credit then an internal savings transfer without counting the money twice or reloading account details', async () => {
  jest.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    walletKeys.data({
      merchantId: 'merchant',
      ownerId: 'customer',
      userId: 'user',
    }),
    cached
  );
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  mockFull.mockResolvedValue(cached);
  mockNumbers.mockResolvedValue({
    wallet: {
      balance: 100,
      total_balance: 300,
      savings_balance: 200,
      loyalty_points: 0,
    },
    goals: [
      {
        id: 'goal',
        current_amount: 200,
        target_amount: 1000,
        status: 'active',
        metadata: walletGoalMetadata(goal) ?? '',
      },
    ],
  });
  mockHistory.mockResolvedValue([credit]);
  const { result, unmount } = renderHook(
    () => useWallet({ cachePolicy: 'display', navigationRefresh: 'numbers' }),
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
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  expect(result.current.data?.wallet.balance).toBe(100);
  expect(result.current.data?.transactions).toEqual([credit]);

  mockNumbers.mockResolvedValue({
    wallet: {
      balance: 0,
      total_balance: 300,
      savings_balance: 300,
      loyalty_points: 0,
    },
    goals: [
      {
        id: 'goal',
        current_amount: 300,
        target_amount: 1000,
        status: 'active',
        metadata: walletGoalMetadata(goal) ?? '',
      },
    ],
  });
  mockHistory.mockResolvedValue([debit, credit]);
  act(() => {
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: { id: 'wallet', merchant_id: 'merchant', customer_id: 'customer' },
    });
    handlers.customer_savings_goals({
      eventType: 'UPDATE',
      new: {
        ...goal,
        current_amount: 300,
        merchant_id: 'merchant',
        customer_id: 'customer',
      },
    });
    handlers.customer_savings_contributions({
      eventType: 'INSERT',
      new: { merchant_id: 'merchant', customer_id: 'customer' },
    });
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  await waitFor(() =>
    expect(result.current.data?.wallet.savings_balance).toBe(300)
  );
  expect(result.current.data?.wallet.balance).toBe(0);
  expect(result.current.data?.wallet.total_balance).toBe(300);
  expect(result.current.data?.wallet.active_savings_goal?.current_amount).toBe(
    300
  );
  expect(result.current.data?.wallet.active_savings_goal?.product_image).toBe(
    'phone.jpg'
  );
  expect(result.current.data?.wallet.funding_account).toEqual(
    cached.wallet.funding_account
  );
  expect(result.current.data?.transactions).toEqual([debit, credit]);
  expect(mockNumbers).toHaveBeenCalledTimes(2);
  expect(mockFull).not.toHaveBeenCalled();
  unmount();
  client.clear();
  jest.useRealTimers();
});

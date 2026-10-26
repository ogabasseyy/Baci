import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useWallet } from './use-wallet';
import { type WalletQueryData, walletKeys } from './wallet-query';

const mockFull = jest.fn();
const mockNumbers = jest.fn();
const mockHistory = jest.fn();
const handlers: Record<string, (payload: unknown) => void> = {};
jest.mock('./wallet-data', () => ({
  fetchWalletData: (...args: unknown[]) => mockFull(...args),
  fetchWalletDataUnbounded: (...args: unknown[]) => mockFull(...args),
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
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/wallet-funding-account', () => ({
  createWalletFundingAccount: jest.fn(),
}));
jest.mock('./use-redeem-points', () => ({ useRedeemPoints: jest.fn() }));
jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return {
    useAuthStore: create(() => ({
      customer: { id: 'customer-1', user_id: 'user-1' },
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    })),
  };
});
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
beforeEach(() => {
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
});
function setup(cached = true) {
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
it('coalesces a bank-credit burst and updates money and history without fetching account or products', async () => {
  const { result, cleanup } = setup();
  act(() => {
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: {
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        id: 'wallet-1',
      },
    });
    handlers.customer_savings_contributions({
      eventType: 'INSERT',
      new: { merchant_id: 'merchant-1', customer_id: 'customer-1' },
    });
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  expect(result.current.data?.transactions).toEqual([credit]);
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  expect(mockHistory).toHaveBeenCalledTimes(1);
  expect(mockFull).not.toHaveBeenCalled();
  expect(result.current.data?.wallet.funding_account).toEqual(
    saved.wallet.funding_account
  );
  cleanup();
});
it('ignores an event from another merchant and drops a queued read after unmount', async () => {
  const { cleanup } = setup();
  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: { merchant_id: 'other', customer_id: 'customer-1' },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(mockFull).not.toHaveBeenCalled();
  expect(mockNumbers).not.toHaveBeenCalled();
  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: { merchant_id: 'merchant-1', customer_id: 'customer-1' },
    })
  );
  cleanup();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(mockNumbers).not.toHaveBeenCalled();
});

it('recovers a failed numeric read through a successful full refresh without showing an error', async () => {
  mockNumbers.mockRejectedValueOnce(new Error('Offline'));
  const recovered = {
    ...saved,
    wallet: { ...saved.wallet, balance: 100, total_balance: 300 },
    transactions: [credit],
  };
  mockFull.mockResolvedValueOnce(recovered);
  const { result, cleanup } = setup();
  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: {
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        id: 'wallet-1',
      },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  expect(mockFull).toHaveBeenCalledTimes(1);
  expect(result.current.data).toEqual(recovered);
  expect(result.current.isError).toBe(false);
  cleanup();
});

it('clears a failed money refresh after a structural refresh succeeds', async () => {
  mockNumbers.mockRejectedValueOnce(new Error('Offline'));
  mockFull.mockRejectedValueOnce(new Error('Offline'));
  const { result, cleanup } = setup();
  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: {
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        id: 'wallet-1',
      },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(result.current.isError).toBe(true);
  expect(result.current.data).toEqual(saved);
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  expect(mockFull).toHaveBeenCalledTimes(1);
  act(() =>
    handlers.customers({
      eventType: 'UPDATE',
      new: { merchant_id: 'merchant-1', id: 'customer-1' },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(mockFull).toHaveBeenCalledTimes(2);
  expect(result.current.isError).toBe(false);
  cleanup();
});

it('does not lose a bank-credit event while the first wallet identity is loading', async () => {
  let complete!: (value: WalletQueryData) => void;
  mockFull.mockReturnValueOnce(
    new Promise<WalletQueryData>((resolve) => {
      complete = resolve;
    })
  );
  mockFull.mockResolvedValue({
    ...saved,
    wallet: { ...saved.wallet, balance: 100, total_balance: 300 },
    transactions: [credit],
  });
  const { result, cleanup } = setup(false);
  act(() =>
    handlers.customer_wallets({
      eventType: 'UPDATE',
      new: {
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        id: 'wallet-1',
      },
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  await act(async () => {
    complete(saved);
    await jest.advanceTimersByTimeAsync(300);
  });
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  expect(mockFull).toHaveBeenCalledTimes(2);
  cleanup();
});

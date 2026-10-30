import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWalletScreenData } from '@/components/wallet/use-wallet-screen-data';
import { type WalletQueryData, walletKeys } from './wallet-query';

const mockFull = jest.fn();
const mockNumbers = jest.fn();
const mockHistory = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
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
      const channel = { on: () => channel, subscribe: jest.fn() };
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
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: { id: 'customer-1', user_id: 'user-1' },
      user: { id: 'user-1' },
      merchantId: 'merchant-1',
    }),
}));

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
    funding_account: {
      account_name: 'Test',
      account_number: '1234567890',
      bank_name: 'Sandbox',
      provider: 'piggyvest',
    },
    savings_goals: [],
    active_savings_goal: null,
  },
  transactions: [
    {
      id: 'transaction-1',
      type: 'credit',
      amount: 200,
      description: 'Saved history',
      created_at: '2026-10-12T10:00:00Z',
    },
  ],
};
const latest = {
  wallet: {
    balance: 100,
    loyalty_points: 10,
    savings_balance: 200,
    total_balance: 300,
    earnings_available: true,
    earnings_balance: 0,
  },
  goals: [],
};
let onAppState!: (state: AppStateStatus) => void;
beforeEach(() => {
  mockFull.mockReset().mockResolvedValue(saved);
  mockNumbers.mockReset().mockResolvedValue(latest);
  mockHistory.mockReset().mockResolvedValue(saved.transactions);
  mockFocused = true;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onAppState = callback;
      return { remove: jest.fn() };
    });
});
afterEach(() => jest.restoreAllMocks());

function setup(cached = true, snapshot: WalletQueryData = saved) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached) client.setQueryData(key, snapshot);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useWalletScreenData(), { wrapper });
  return {
    ...hook,
    client,
    cleanup: () => {
      hook.unmount();
      client.clear();
    },
  };
}

it('refreshes numbers and history on opening a cached wallet while preserving account details', async () => {
  const { result, cleanup } = setup();
  expect(mockFull).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  expect(mockFull).not.toHaveBeenCalled();
  expect(result.current.data?.wallet.funding_account).toBe(
    saved.wallet.funding_account
  );
  expect(result.current.data?.transactions).toBe(saved.transactions);
  cleanup();
});

it('uses the lightweight read on tab navigation and app resume', async () => {
  const { result, rerender, cleanup } = setup();
  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  mockFocused = false;
  rerender({});
  mockFocused = true;
  rerender({});
  await waitFor(() => expect(mockNumbers).toHaveBeenCalledTimes(2));
  act(() => {
    onAppState('background');
    onAppState('active');
  });
  await waitFor(() => expect(mockNumbers).toHaveBeenCalledTimes(3));
  expect(mockFull).not.toHaveBeenCalled();
  cleanup();
});

it('retains full loading for the first visit and manual refresh', async () => {
  const { result, cleanup } = setup(false);
  await waitFor(() => expect(result.current.data).toEqual(saved));
  expect(mockFull).toHaveBeenCalledTimes(1);
  expect(mockNumbers).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.refetch();
  });
  expect(mockFull).toHaveBeenCalledTimes(2);
  cleanup();
});

it('replaces a cached zero and empty history with the full bank-credit read when numeric interest is unavailable', async () => {
  const snapshot: WalletQueryData = {
    ...saved,
    wallet: { ...saved.wallet, savings_balance: 0, total_balance: 0 },
    transactions: [],
  };
  const credited: WalletQueryData = {
    ...snapshot,
    wallet: {
      ...snapshot.wallet,
      balance: 100,
      total_balance: 100,
      earnings_available: false,
      earnings_balance: null,
    },
    transactions: [
      {
        id: 'bank-credit',
        type: 'credit',
        amount: 100,
        description: 'PiggyVest bank transfer',
        created_at: '2026-10-24T10:00:00Z',
        source_type: 'piggyvest_primary_inflow',
      },
    ],
  };
  mockNumbers.mockRejectedValue(
    new Error('Could not refresh savings interest')
  );
  mockFull.mockResolvedValue(credited);
  const { result, cleanup } = setup(true, snapshot);

  await waitFor(() => expect(result.current.data?.wallet.balance).toBe(100));

  expect(result.current.data?.transactions).toEqual(credited.transactions);
  expect(result.current.data?.wallet.earnings_balance).toBeNull();
  expect(result.current.data?.wallet.earnings_available).toBe(false);
  await waitFor(() => expect(result.current.refreshState).toBeUndefined());
  expect(mockFull).toHaveBeenCalledTimes(1);
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  cleanup();
});

it('keeps the cached wallet and reports an error when both numeric and full reads fail', async () => {
  mockNumbers.mockRejectedValue(
    new Error('Could not refresh savings interest')
  );
  mockFull.mockRejectedValue(new Error('Offline'));
  const { result, cleanup } = setup();

  await waitFor(() => expect(result.current.refreshState).toBe('error'));

  expect(result.current.data).toEqual(saved);
  expect(mockFull).toHaveBeenCalledTimes(1);
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  cleanup();
});

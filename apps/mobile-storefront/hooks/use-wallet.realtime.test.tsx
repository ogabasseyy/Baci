import { onlineManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { createWalletRealtimeTestHarness } from './use-wallet.realtime.test-harness';
import type { WalletQueryData } from './wallet-query';

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
const { credit, key, saved, setup, walletKeys } =
  createWalletRealtimeTestHarness({
    handlers,
    mockFull,
    mockNumbers,
    mockHistory,
  });
it('debounces savings realtime invalidations across goals and contributions', async () => {
  const { result, client, cleanup } = setup();
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
  const derivedWalletKey = [...key, 'derived-numbers'] as const;
  client.setQueryData(derivedWalletKey, { total: 750 });
  invalidateSpy.mockClear();

  act(() => {
    handlers.customer_savings_goals(undefined);
    handlers.customer_savings_contributions(undefined);
    handlers.customer_savings_contributions(undefined);
  });

  expect(invalidateSpy).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(invalidateSpy).toHaveBeenCalledTimes(1);
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key, exact: false });
  expect(client.getQueryState(derivedWalletKey)?.isInvalidated).toBe(true);
  cleanup();
});
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
it('refreshes balances and history on foreground reconnect without a full wallet read', async () => {
  const { result, cleanup } = setup();
  act(() => onlineManager.setOnline(false));
  act(() => onlineManager.setOnline(true));

  await waitFor(() =>
    expect(result.current.data?.wallet.total_balance).toBe(300)
  );
  expect(result.current.data?.transactions).toEqual([credit]);
  expect(mockNumbers).toHaveBeenCalledTimes(1);
  expect(mockHistory).toHaveBeenCalledTimes(1);
  expect(mockFull).not.toHaveBeenCalled();
  cleanup();
});
it('drops an in-flight reconnect read when wallet ownership scope changes', async () => {
  let completeNumbers!: (value: {
    wallet: {
      balance: number;
      total_balance: number;
      savings_balance: number;
      loyalty_points: number;
    };
    goals: [];
  }) => void;
  mockNumbers.mockReturnValueOnce(
    new Promise((resolve) => {
      completeNumbers = resolve;
    })
  );
  const { client, cleanup } = setup();
  const nextKey = walletKeys.data({
    merchantId: 'merchant-2',
    ownerId: 'customer-1',
    userId: 'user-1',
  });
  client.setQueryData(nextKey, saved);

  act(() => onlineManager.setOnline(false));
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(mockNumbers).toHaveBeenCalledTimes(1));
  act(() => useAuthStore.setState({ merchantId: 'merchant-2' }));
  await act(async () =>
    completeNumbers({
      wallet: {
        balance: 999,
        total_balance: 999,
        savings_balance: 0,
        loyalty_points: 0,
      },
      goals: [],
    })
  );

  expect(client.getQueryData(key)).toEqual(saved);
  expect(client.getQueryData(nextKey)).toEqual(saved);
  expect(mockFull).not.toHaveBeenCalled();
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
